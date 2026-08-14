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

  async createSessionAndMarkUserLogin(input: {
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
          userAgent: input.userAgent ?? null,
          ipAddress: input.ipAddress ?? null,
        },
        select: sessionSelect,
      });
      await transaction.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return session;
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
      where: { id: sessionId, revokedAt: null },
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
      where: { id: sessionId, revokedAt: null },
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
