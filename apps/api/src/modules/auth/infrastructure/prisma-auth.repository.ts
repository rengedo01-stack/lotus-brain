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

const MAX_ACTIVE_CSRF_TOKENS_PER_SESSION = 8;

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
      await transaction.identityCsrfToken.upsert({
        where: { tokenHash: session.csrfTokenHash },
        create: {
          identitySessionId: session.id,
          tokenHash: session.csrfTokenHash,
          issuedAt: now,
          expiresAt: input.expiresAt,
        },
        update: {
          identitySessionId: session.id,
          expiresAt: input.expiresAt,
        },
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
      await transaction.identityCsrfToken.deleteMany({
        where: { identitySession: { userId: input.userId } },
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

  async issueSessionCsrfToken(input: {
    sessionId: string;
    csrfTokenHash: string;
    mirrorLegacyScalar: boolean;
  }): Promise<AuthSessionView | null> {
    const reference = await this.prisma.identitySession.findUnique({
      where: { id: input.sessionId },
      select: { userId: true },
    });
    if (reference === null) return null;

    // All active-token issuance follows User -> IdentitySession ->
    // IdentityCsrfToken locking. Revocation paths use the same prefix so a
    // concurrent revocation either precedes issuance or deletes its token
    // before committing; a revoked session can never retain a live token.
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
      if (user === null || user.status !== "ACTIVE" || user.deletedAt !== null) return null;

      const sessions = await transaction.$queryRaw<Array<{
        id: string;
        userId: string;
        credentialVersion: number;
        authenticationPolicyVersion: number;
        expiresAt: Date;
        activatedAt: Date | null;
        revokedAt: Date | null;
      }>>(Prisma.sql`
        SELECT "id", "userId", "credentialVersion", "authenticationPolicyVersion", "expiresAt", "activatedAt", "revokedAt"
        FROM "IdentitySession"
        WHERE "id" = ${input.sessionId}
        FOR UPDATE
      `);
      const session = sessions[0] ?? null;
      const now = new Date();
      if (
        session === null ||
        session.userId !== user.id ||
        session.activatedAt === null ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        session.credentialVersion !== user.credentialVersion ||
        session.authenticationPolicyVersion !== user.authenticationPolicyVersion
      ) {
        return null;
      }

      await transaction.identityCsrfToken.deleteMany({
        where: { identitySessionId: session.id, expiresAt: { lte: now } },
      });
      const existingTokens = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "IdentityCsrfToken"
        WHERE "identitySessionId" = ${session.id}
        ORDER BY "issuedAt" ASC, "id" ASC
        FOR UPDATE
      `);
      const overflow = existingTokens.length - (MAX_ACTIVE_CSRF_TOKENS_PER_SESSION - 1);
      if (overflow > 0) {
        await transaction.identityCsrfToken.deleteMany({
          where: { id: { in: existingTokens.slice(0, overflow).map((token) => token.id) } },
        });
      }
      await transaction.identityCsrfToken.create({
        data: {
          identitySessionId: session.id,
          tokenHash: input.csrfTokenHash,
          issuedAt: now,
          expiresAt: session.expiresAt,
        },
      });
      await transaction.identitySession.update({
        where: { id: session.id },
        data: {
          ...(input.mirrorLegacyScalar ? { csrfTokenHash: input.csrfTokenHash } : {}),
          lastSeenAt: now,
        },
      });
      return transaction.identitySession.findUnique({ where: { id: session.id }, select: sessionSelect });
    });
  }

  async isSessionCsrfTokenValid(input: {
    sessionId: string;
    csrfTokenHash: string;
    allowLegacyScalarFallback: boolean;
  }): Promise<boolean> {
    const now = new Date();
    const tableTokens = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "token"."id"
      FROM "IdentityCsrfToken" AS "token"
      INNER JOIN "IdentitySession" AS "session" ON "token"."identitySessionId" = "session"."id"
      INNER JOIN "User" AS "user" ON "user"."id" = "session"."userId"
      WHERE "token"."tokenHash" = ${input.csrfTokenHash}
        AND "token"."expiresAt" > ${now}
        AND "session"."id" = ${input.sessionId}
        AND "session"."activatedAt" IS NOT NULL
        AND "session"."revokedAt" IS NULL
        AND "session"."expiresAt" > ${now}
        AND "user"."status" = 'ACTIVE'
        AND "user"."deletedAt" IS NULL
        AND "session"."credentialVersion" = "user"."credentialVersion"
        AND "session"."authenticationPolicyVersion" = "user"."authenticationPolicyVersion"
      LIMIT 1
    `);
    if (tableTokens.length === 1) return true;
    if (!input.allowLegacyScalarFallback) return false;

    const legacyTokens = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "session"."id"
      FROM "IdentitySession" AS "session"
      INNER JOIN "User" AS "user" ON "user"."id" = "session"."userId"
      WHERE "session"."csrfTokenHash" = ${input.csrfTokenHash}
        AND "session"."id" = ${input.sessionId}
        AND "session"."activatedAt" IS NOT NULL
        AND "session"."revokedAt" IS NULL
        AND "session"."expiresAt" > ${now}
        AND "user"."status" = 'ACTIVE'
        AND "user"."deletedAt" IS NULL
        AND "session"."credentialVersion" = "user"."credentialVersion"
        AND "session"."authenticationPolicyVersion" = "user"."authenticationPolicyVersion"
      LIMIT 1
    `);
    return legacyTokens.length === 1;
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const reference = await this.prisma.identitySession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (reference === null) return false;

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${reference.userId}
        FOR UPDATE
      `);
      const sessions = await transaction.$queryRaw<Array<{ id: string; revokedAt: Date | null }>>(Prisma.sql`
        SELECT "id", "revokedAt"
        FROM "IdentitySession"
        WHERE "id" = ${sessionId}
        FOR UPDATE
      `);
      const session = sessions[0] ?? null;
      if (session === null || session.revokedAt !== null) return false;
      await transaction.identitySession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await transaction.identityCsrfToken.deleteMany({ where: { identitySessionId: session.id } });
      return true;
    });
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
