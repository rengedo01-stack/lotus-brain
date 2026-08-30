import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  AuthRepository,
  AuthLoginUserView,
  AuthPasswordCredentialView,
  AuthSessionUserView,
  AuthSessionView,
  AuthUserView,
  ChangePasswordInput,
} from "../application/auth.repository";
import { normalizeEmail } from "../auth.utils";
import { SystemRoleCodes } from "../../authorization/authorization.constants";
import { AuthConflictError, AuthInvalidCredentialsError } from "../auth.errors";

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const sessionUserSelect = {
  ...userSelect,
  deletedAt: true,
  credentialVersion: true,
  authenticationPolicyVersion: true,
} as const;

const sessionSelect = {
  id: true,
  userId: true,
  expiresAt: true,
  activatedAt: true,
  revokedAt: true,
  csrfTokenHash: true,
  credentialVersion: true,
  authenticationPolicyVersion: true,
  lastSeenAt: true,
} as const;

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmail(email: string): Promise<(AuthLoginUserView & { passwordHash: string }) | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: {
        ...userSelect,
        passwordHash: true,
        deletedAt: true,
        credentialVersion: true,
        authenticationPolicyVersion: true,
        passkeyMfaEnabledAt: true,
      },
    });
  }

  async findUserCredentialById(userId: string): Promise<AuthPasswordCredentialView | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        credentialVersion: true,
        authenticationPolicyVersion: true,
        status: true,
        deletedAt: true,
      },
    });
  }

  async findUserById(id: string): Promise<AuthUserView | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<
    (AuthSessionView & { user: AuthSessionUserView | null }) | null
  > {
    return this.prisma.identitySession.findUnique({
      where: { tokenHash },
      select: {
        ...sessionSelect,
        user: { select: sessionUserSelect },
      },
    });
  }

  async createPendingSession(input: {
    userId: string;
    credentialVersion: number;
    authenticationPolicyVersion: number;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthSessionView> {
    return this.prisma.$transaction(async (transaction) => {
      // This short row lock is acquired only after Argon2 verification. It
      // serializes login's credential snapshot with a concurrent password
      // change; the DB trigger independently enforces the same invariant.
      const lockedUsers = await transaction.$queryRaw<Array<{
        id: string;
        credentialVersion: number;
        authenticationPolicyVersion: number;
        status: "ACTIVE" | "DISABLED" | "LOCKED";
        deletedAt: Date | null;
      }>>(Prisma.sql`
        SELECT "id", "credentialVersion", "authenticationPolicyVersion", "status", "deletedAt"
        FROM "User"
        WHERE "id" = ${input.userId}
        FOR UPDATE
      `);
      const user = lockedUsers[0] ?? null;
      if (
        user === null ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.credentialVersion !== input.credentialVersion
        || user.authenticationPolicyVersion !== input.authenticationPolicyVersion
      ) {
        throw new AuthInvalidCredentialsError("Invalid email or password.");
      }

      const session = await transaction.identitySession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          csrfTokenHash: input.csrfTokenHash,
          credentialVersion: input.credentialVersion,
          authenticationPolicyVersion: input.authenticationPolicyVersion,
          expiresAt: input.expiresAt,
          activatedAt: null,
          userAgent: input.userAgent ?? null,
          ipAddress: input.ipAddress ?? null,
        },
        select: sessionSelect,
      });
      return session;
    });
  }

  async activateSession(input: {
    csrfTokenHash: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<"ACTIVATED" | "ALREADY_ACTIVATED" | "CSRF_INVALID" | "UNAUTHORIZED"> {
    // User -> session is the common write-lock order for password changes and
    // MFA policy transitions. It guarantees that activation can never revive a
    // session after a concurrent invalidation has committed.
    const reference = await this.prisma.identitySession.findUnique({
      where: { tokenHash: input.tokenHash },
      select: { userId: true },
    });
    if (reference === null) return "UNAUTHORIZED";

    return this.prisma.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw<Array<{
        id: string;
        credentialVersion: number;
        authenticationPolicyVersion: number;
        status: "ACTIVE" | "DISABLED" | "LOCKED";
        deletedAt: Date | null;
      }>>(Prisma.sql`
        SELECT "id", "credentialVersion", "authenticationPolicyVersion", "status", "deletedAt"
        FROM "User"
        WHERE "id" = ${reference.userId}
        FOR UPDATE
      `);
      const user = users[0] ?? null;
      if (user === null) return "UNAUTHORIZED";

      const sessions = await transaction.$queryRaw<Array<{
        id: string;
        userId: string;
        credentialVersion: number;
        authenticationPolicyVersion: number;
        csrfTokenHash: string;
        expiresAt: Date;
        activatedAt: Date | null;
        revokedAt: Date | null;
      }>>(Prisma.sql`
        SELECT
          "id", "userId", "credentialVersion", "authenticationPolicyVersion", "csrfTokenHash",
          "expiresAt", "activatedAt", "revokedAt"
        FROM "IdentitySession"
        WHERE "tokenHash" = ${input.tokenHash}
        FOR UPDATE
      `);
      const session = sessions[0] ?? null;
      const now = new Date();
      if (
        session === null ||
        session.userId !== user.id ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        session.credentialVersion !== user.credentialVersion ||
        session.authenticationPolicyVersion !== user.authenticationPolicyVersion
      ) {
        return "UNAUTHORIZED";
      }
      if (session.csrfTokenHash !== input.csrfTokenHash) return "CSRF_INVALID";
      if (session.activatedAt !== null) return "ALREADY_ACTIVATED";

      await transaction.identitySession.update({
        where: { id: session.id },
        data: { activatedAt: now, expiresAt: input.expiresAt },
      });
      await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      return "ACTIVATED";
    });
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: {
          id: input.userId,
          credentialVersion: input.expectedCredentialVersion,
          status: "ACTIVE",
          deletedAt: null,
        },
        data: {
          passwordHash: input.passwordHash,
          credentialVersion: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        const current = await transaction.user.findUnique({
          where: { id: input.userId },
          select: { status: true, deletedAt: true },
        });
        if (current === null || current.status !== "ACTIVE" || current.deletedAt !== null) {
          throw new AuthInvalidCredentialsError("Invalid credentials.");
        }
        throw new AuthConflictError("Credential state changed. Retry with your current password.");
      }

      await transaction.identitySession.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "CHANGE_PASSWORD",
          actorUserId: input.userId,
          targetUserId: input.userId,
          beforeState: { credentialVersion: input.expectedCredentialVersion },
          afterState: { credentialVersion: input.expectedCredentialVersion + 1 },
        },
      });
    });
  }

  async rotateSessionCsrfToken(sessionId: string, csrfTokenHash: string): Promise<AuthSessionView | null> {
    const result = await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null, activatedAt: { not: null } },
      data: {
        csrfTokenHash,
        lastSeenAt: new Date(),
      },
    });
    if (result.count === 0) return null;
    return this.prisma.identitySession.findUnique({
      where: { id: sessionId },
      select: sessionSelect,
    });
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const result = await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async touchSession(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.prisma.identitySession.updateMany({
      where: { id: sessionId, revokedAt: null, activatedAt: { not: null } },
      data: { lastSeenAt },
    });
  }

  async getUserCount(): Promise<number> {
    return this.prisma.user.count();
  }

  async bootstrapUser(input: { email: string; displayName: string; passwordHash: string }): Promise<AuthUserView> {
    return this.prisma.$transaction(async (transaction) => {
      const legacyRole = await transaction.role.findUnique({
        where: { code: SystemRoleCodes.LEGACY_AUTHENTICATED },
        select: { id: true },
      });
      if (legacyRole === null) {
        throw new Error("LEGACY_AUTHENTICATED role is not configured. Apply the RBAC migration before bootstrapping a user.");
      }

      const user = await transaction.user.create({
        data: {
          email: normalizeEmail(input.email),
          displayName: input.displayName,
          passwordHash: input.passwordHash,
        },
        select: userSelect,
      });
      await transaction.userRole.create({
        data: { userId: user.id, roleId: legacyRole.id },
      });
      return user;
    });
  }
}
