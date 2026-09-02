import { Injectable } from "@nestjs/common";
import { Prisma, type NotificationOutboxKind, type NotificationOutboxStatus, type UserStatus } from "../../../generated/prisma/client";
import { hashSecret, makeOpaqueToken } from "../../auth/auth.utils";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS,
  PASSWORD_RECOVERY_REQUEST_COOLDOWN_MS,
} from "../notification.constants";
import {
  EmailVerificationTokenInvalidError,
  PasswordRecoveryTokenInvalidError,
} from "../application/recovery-channel.errors";
import type {
  CompletePasswordResetInput,
  NotificationOutboxClaim,
  PasswordResetPreparation,
  PreparedEmailVerificationDelivery,
  PreparedPasswordRecoveryDelivery,
  PreparedPasswordResetCompletedDelivery,
  PreparedSecurityNotificationDelivery,
  RecoveryChannelRepository,
} from "../application/recovery-channel.repository";

type VerificationTokenRecord = {
  consumedAt: Date | null;
  emailVersionSnapshot: number;
  expiresAt: Date;
  id: string;
  invalidatedAt: Date | null;
  userDeletedAt: Date | null;
  userEmailVerificationVersion: number;
  userEmailVerifiedAt: Date | null;
  userId: string;
  userStatus: UserStatus;
};

type PasswordRecoveryTokenRecord = {
  consumedAt: Date | null;
  credentialVersionSnapshot: number;
  emailVerificationVersionSnapshot: number;
  expiresAt: Date;
  id: string;
  invalidatedAt: Date | null;
  passwordHash: string;
  userCredentialVersion: number;
  userAuthenticationPolicyVersion: number;
  userDeletedAt: Date | null;
  userEmail: string;
  userEmailVerificationVersion: number;
  userEmailVerifiedAt: Date | null;
  userId: string;
  userPasskeyMfaEnabledAt: Date | null;
  userStatus: UserStatus;
};

type OutboxRecord = {
  attemptCount: number;
  claimedBy: string | null;
  credentialVersionSnapshot: number | null;
  destinationAddress: string | null;
  emailVersionSnapshot: number;
  id: string;
  kind: NotificationOutboxKind;
  leaseUntil: Date | null;
  status: NotificationOutboxStatus;
  userId: string;
};

type VerificationUserRecord = {
  credentialVersion: number;
  deletedAt: Date | null;
  email: string;
  emailVerificationVersion: number;
  emailVerifiedAt: Date | null;
  id: string;
  status: UserStatus;
};

@Injectable()
export class PrismaRecoveryChannelRepository implements RecoveryChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async requestEmailVerification(userId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUserById(transaction, userId);
      if (user === null || user.status !== "ACTIVE" || user.deletedAt !== null || user.emailVerifiedAt !== null) {
        return;
      }

      const recentlyRequested = await transaction.notificationOutbox.findFirst({
        where: {
          kind: "EMAIL_VERIFICATION",
          userId: user.id,
          createdAt: { gte: new Date(Date.now() - EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recentlyRequested !== null) return;

      await transaction.notificationOutbox.create({
        data: {
          kind: "EMAIL_VERIFICATION",
          userId: user.id,
          destinationAddress: user.email,
          emailVersionSnapshot: user.emailVerificationVersion,
        },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "EMAIL_VERIFICATION_REQUESTED",
          actorUserId: user.id,
          targetUserId: user.id,
          beforeState: { emailVerificationVersion: user.emailVerificationVersion },
          afterState: { emailVerificationRequested: true },
        },
      });
    });
  }

  async confirmEmailVerification(tokenHash: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<VerificationTokenRecord[]>(Prisma.sql`
        SELECT
          "EmailVerificationToken"."id",
          "EmailVerificationToken"."userId",
          "EmailVerificationToken"."emailVersionSnapshot",
          "EmailVerificationToken"."expiresAt",
          "EmailVerificationToken"."consumedAt",
          "EmailVerificationToken"."invalidatedAt",
          "User"."status" AS "userStatus",
          "User"."deletedAt" AS "userDeletedAt",
          "User"."emailVerifiedAt" AS "userEmailVerifiedAt",
          "User"."emailVerificationVersion" AS "userEmailVerificationVersion"
        FROM "EmailVerificationToken"
        JOIN "User" ON "User"."id" = "EmailVerificationToken"."userId"
        WHERE "EmailVerificationToken"."tokenHash" = ${tokenHash}
        FOR UPDATE OF "EmailVerificationToken", "User"
      `);
      const token = rows[0] ?? null;
      const now = new Date();
      if (
        token === null ||
        token.consumedAt !== null ||
        token.invalidatedAt !== null ||
        token.expiresAt <= now ||
        token.userStatus !== "ACTIVE" ||
        token.userDeletedAt !== null ||
        token.userEmailVerifiedAt !== null ||
        token.emailVersionSnapshot !== token.userEmailVerificationVersion
      ) {
        throw new EmailVerificationTokenInvalidError("Verification token is invalid or expired.");
      }

      await transaction.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      });
      await transaction.emailVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: now },
      });
      await transaction.emailVerificationToken.updateMany({
        where: {
          userId: token.userId,
          emailVersionSnapshot: token.emailVersionSnapshot,
          id: { not: token.id },
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "EMAIL_VERIFIED",
          actorUserId: null,
          targetUserId: token.userId,
          beforeState: { emailVerified: false, emailVerificationVersion: token.emailVersionSnapshot },
          afterState: { emailVerified: true, emailVerificationVersion: token.emailVersionSnapshot },
        },
      });
    });
  }

  async requestPasswordRecovery(canonicalEmail: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const users = await transaction.$queryRaw<VerificationUserRecord[]>(Prisma.sql`
        SELECT "id", "email", "credentialVersion", "emailVerifiedAt", "emailVerificationVersion", "status", "deletedAt"
        FROM "User"
        WHERE "email" = ${canonicalEmail}
        FOR UPDATE
      `);
      const user = users[0] ?? null;
      if (user === null || user.status !== "ACTIVE" || user.deletedAt !== null || user.emailVerifiedAt === null) {
        return;
      }

      const recentlyRequested = await transaction.notificationOutbox.findFirst({
        where: {
          kind: "PASSWORD_RECOVERY",
          userId: user.id,
          createdAt: { gte: new Date(Date.now() - PASSWORD_RECOVERY_REQUEST_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recentlyRequested !== null) return;

      await transaction.notificationOutbox.create({
        data: {
          kind: "PASSWORD_RECOVERY",
          userId: user.id,
          destinationAddress: user.email,
          emailVersionSnapshot: user.emailVerificationVersion,
          credentialVersionSnapshot: user.credentialVersion,
        },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "PASSWORD_RECOVERY_REQUESTED",
          actorUserId: null,
          targetUserId: user.id,
          beforeState: {
            credentialVersion: user.credentialVersion,
            emailVerificationVersion: user.emailVerificationVersion,
          },
          afterState: { passwordRecoveryRequested: true },
        },
      });
    });
  }

  async preparePasswordReset(tokenHash: string): Promise<PasswordResetPreparation | null> {
    const token = await this.findPasswordRecoveryToken(tokenHash, false);
    if (token === null || !this.isUsablePasswordRecoveryToken(token, new Date())) return null;
    return { passwordHash: token.passwordHash };
  }

  async completePasswordReset(input: CompletePasswordResetInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const token = await this.findPasswordRecoveryToken(input.tokenHash, true, transaction);
      const now = new Date();
      if (token === null || !this.isUsablePasswordRecoveryToken(token, now)) {
        throw new PasswordRecoveryTokenInvalidError("Recovery credential is invalid or expired.");
      }

      const resetPasskeyMfa = token.userPasskeyMfaEnabledAt !== null;
      await transaction.user.update({
        where: { id: token.userId },
        data: resetPasskeyMfa
          ? {
              passwordHash: input.passwordHash,
              credentialVersion: { increment: 1 },
              passkeyMfaEnabledAt: null,
              authenticationPolicyVersion: { increment: 1 },
            }
          : {
              passwordHash: input.passwordHash,
              credentialVersion: { increment: 1 },
            },
      });
      if (resetPasskeyMfa) {
        await transaction.webAuthnCredential.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      await transaction.passwordRecoveryToken.update({
        where: { id: token.id },
        data: { consumedAt: now },
      });
      await transaction.passwordRecoveryToken.updateMany({
        where: {
          userId: token.userId,
          id: { not: token.id },
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      await transaction.identitySession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.identityCsrfToken.deleteMany({
        where: { identitySession: { userId: token.userId } },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "PASSWORD_RESET_COMPLETED",
          actorUserId: null,
          targetUserId: token.userId,
          beforeState: { credentialVersion: token.userCredentialVersion },
          afterState: { credentialVersion: token.userCredentialVersion + 1 },
        },
      });
      if (resetPasskeyMfa) {
        await transaction.identityAuditLog.create({
          data: {
            action: "PASSKEYS_RESET_BY_RECOVERY",
            actorUserId: null,
            targetUserId: token.userId,
            beforeState: {
              mfaEnabled: true,
              authenticationPolicyVersion: token.userAuthenticationPolicyVersion,
            },
            afterState: {
              mfaEnabled: false,
              authenticationPolicyVersion: token.userAuthenticationPolicyVersion + 1,
              activePasskeysRevoked: true,
            },
          },
        });
      }
      await transaction.notificationOutbox.create({
        data: {
          kind: "PASSWORD_RESET_COMPLETED",
          userId: token.userId,
          destinationAddress: token.userEmail,
          emailVersionSnapshot: token.userEmailVerificationVersion,
          credentialVersionSnapshot: token.userCredentialVersion + 1,
        },
      });
      if (resetPasskeyMfa) {
        await transaction.notificationOutbox.create({
          data: {
            kind: "AUTHENTICATORS_RESET_BY_RECOVERY",
            userId: token.userId,
            destinationAddress: token.userEmail,
            emailVersionSnapshot: token.userEmailVerificationVersion,
            credentialVersionSnapshot: token.userCredentialVersion + 1,
          },
        });
      }
    });
  }

  async claimDueEmailVerification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null> {
    return this.claimDueOutbox(
      workerId,
      now,
      leaseUntil,
      Prisma.sql`"kind" = 'EMAIL_VERIFICATION'::"NotificationOutboxKind"`,
    );
  }

  async claimDueNotification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null> {
    return this.claimDueOutbox(
      workerId,
      now,
      leaseUntil,
      Prisma.sql`"kind" IN (
        'EMAIL_VERIFICATION'::"NotificationOutboxKind",
        'PASSWORD_RECOVERY'::"NotificationOutboxKind",
        'PASSWORD_RESET_COMPLETED'::"NotificationOutboxKind",
        'PASSKEY_REGISTERED'::"NotificationOutboxKind",
        'PASSKEY_MFA_ENABLED'::"NotificationOutboxKind",
        'PASSKEY_MFA_DISABLED'::"NotificationOutboxKind",
        'AUTHENTICATORS_RESET_BY_RECOVERY'::"NotificationOutboxKind"
      )`,
    );
  }

  private async claimDueOutbox(
    workerId: string,
    now: Date,
    leaseUntil: Date,
    kindPredicate: Prisma.Sql,
  ): Promise<NotificationOutboxClaim | null> {
    const claimed = await this.prisma.$queryRaw<NotificationOutboxClaim[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE ${kindPredicate}
          AND (
            ("status" = 'PENDING'::"NotificationOutboxStatus" AND "nextAttemptAt" <= ${now})
            OR
            ("status" = 'PROCESSING'::"NotificationOutboxStatus" AND "leaseUntil" <= ${now})
          )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC, "id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "NotificationOutbox" AS "outbox"
      SET
        "status" = 'PROCESSING'::"NotificationOutboxStatus",
        "claimedBy" = ${workerId},
        "leaseUntil" = ${leaseUntil},
        "attemptCount" = "outbox"."attemptCount" + 1,
        "lastErrorCode" = NULL
      FROM candidate
      WHERE "outbox"."id" = candidate."id"
      RETURNING
        "outbox"."id",
        "outbox"."kind",
        "outbox"."userId",
        "outbox"."destinationAddress",
        "outbox"."emailVersionSnapshot",
        "outbox"."credentialVersionSnapshot",
        "outbox"."attemptCount"
    `);
    return claimed[0] ?? null;
  }

  async prepareEmailVerificationDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedEmailVerificationDelivery | null> {
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await this.lockClaimedOutbox(transaction, claim, workerId, now, "EMAIL_VERIFICATION");
      if (outbox === null) return null;

      const user = await this.lockUserById(transaction, outbox.userId);
      if (
        user === null ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.emailVerifiedAt !== null ||
        user.email !== outbox.destinationAddress ||
        user.emailVerificationVersion !== outbox.emailVersionSnapshot
      ) {
        await this.cancelOutbox(transaction, outbox.id, now);
        return null;
      }

      const rawToken = makeOpaqueToken();
      await transaction.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(rawToken),
          emailVersionSnapshot: user.emailVerificationVersion,
          expiresAt,
        },
      });
      return { destinationAddress: user.email, expiresAt, rawToken };
    });
  }

  async preparePasswordRecoveryDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedPasswordRecoveryDelivery | null> {
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await this.lockClaimedOutbox(transaction, claim, workerId, now, "PASSWORD_RECOVERY");
      if (outbox === null || outbox.credentialVersionSnapshot === null) return null;

      const user = await this.lockUserById(transaction, outbox.userId);
      if (
        user === null ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.emailVerifiedAt === null ||
        user.email !== outbox.destinationAddress ||
        user.emailVerificationVersion !== outbox.emailVersionSnapshot ||
        user.credentialVersion !== outbox.credentialVersionSnapshot
      ) {
        await this.cancelOutbox(transaction, outbox.id, now);
        return null;
      }

      const rawToken = makeOpaqueToken();
      await transaction.passwordRecoveryToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(rawToken),
          credentialVersionSnapshot: user.credentialVersion,
          emailVerificationVersionSnapshot: user.emailVerificationVersion,
          expiresAt,
        },
      });
      return { destinationAddress: user.email, expiresAt, rawToken };
    });
  }

  async preparePasswordResetCompletedDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
  ): Promise<PreparedPasswordResetCompletedDelivery | null> {
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await this.lockClaimedOutbox(transaction, claim, workerId, now, "PASSWORD_RESET_COMPLETED");
      if (outbox === null || outbox.destinationAddress === null) return null;
      return { destinationAddress: outbox.destinationAddress };
    });
  }

  async prepareSecurityNotificationDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
  ): Promise<PreparedSecurityNotificationDelivery | null> {
    const securityKind = claim.kind;
    if (
      securityKind !== "PASSKEY_REGISTERED" &&
      securityKind !== "PASSKEY_MFA_ENABLED" &&
      securityKind !== "PASSKEY_MFA_DISABLED" &&
      securityKind !== "AUTHENTICATORS_RESET_BY_RECOVERY"
    ) {
      return null;
    }
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await this.lockClaimedOutbox(transaction, claim, workerId, now, securityKind);
      if (outbox === null || outbox.destinationAddress === null) return null;
      return { destinationAddress: outbox.destinationAddress, kind: securityKind };
    });
  }

  async markEmailVerificationSent(outboxId: string, workerId: string, now: Date): Promise<void> {
    await this.prisma.notificationOutbox.updateMany({
      where: { id: outboxId, status: "PROCESSING", claimedBy: workerId },
      data: {
        status: "SENT",
        destinationAddress: null,
        claimedBy: null,
        leaseUntil: null,
        sentAt: now,
      },
    });
  }

  async markEmailVerificationFailed(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    errorCode: string,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const outbox = await transaction.notificationOutbox.findFirst({
        where: { id: claim.id, status: "PROCESSING", claimedBy: workerId },
        select: { id: true, attemptCount: true },
      });
      if (outbox === null) return;
      const exhausted = nextAttemptAt === null;
      await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: exhausted
          ? {
              status: "DEAD",
              destinationAddress: null,
              claimedBy: null,
              leaseUntil: null,
              terminalAt: now,
              lastErrorCode: errorCode,
            }
          : {
              status: "PENDING",
              claimedBy: null,
              leaseUntil: null,
              nextAttemptAt,
              lastErrorCode: errorCode,
            },
      });
    });
  }

  private async lockUserById(transaction: Prisma.TransactionClient, userId: string): Promise<VerificationUserRecord | null> {
    const users = await transaction.$queryRaw<VerificationUserRecord[]>(Prisma.sql`
      SELECT "id", "email", "credentialVersion", "emailVerifiedAt", "emailVerificationVersion", "status", "deletedAt"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `);
    return users[0] ?? null;
  }

  private async findPasswordRecoveryToken(
    tokenHash: string,
    lock: boolean,
    transaction: Prisma.TransactionClient = this.prisma,
  ): Promise<PasswordRecoveryTokenRecord | null> {
    const lockClause = lock ? Prisma.sql`FOR UPDATE OF "PasswordRecoveryToken", "User"` : Prisma.empty;
    const rows = await transaction.$queryRaw<PasswordRecoveryTokenRecord[]>(Prisma.sql`
      SELECT
        "PasswordRecoveryToken"."id",
        "PasswordRecoveryToken"."userId",
        "PasswordRecoveryToken"."credentialVersionSnapshot",
        "PasswordRecoveryToken"."emailVerificationVersionSnapshot",
        "PasswordRecoveryToken"."expiresAt",
        "PasswordRecoveryToken"."consumedAt",
        "PasswordRecoveryToken"."invalidatedAt",
        "User"."passwordHash" AS "passwordHash",
        "User"."credentialVersion" AS "userCredentialVersion",
        "User"."authenticationPolicyVersion" AS "userAuthenticationPolicyVersion",
        "User"."passkeyMfaEnabledAt" AS "userPasskeyMfaEnabledAt",
        "User"."email" AS "userEmail",
        "User"."status" AS "userStatus",
        "User"."deletedAt" AS "userDeletedAt",
        "User"."emailVerifiedAt" AS "userEmailVerifiedAt",
        "User"."emailVerificationVersion" AS "userEmailVerificationVersion"
      FROM "PasswordRecoveryToken"
      JOIN "User" ON "User"."id" = "PasswordRecoveryToken"."userId"
      WHERE "PasswordRecoveryToken"."tokenHash" = ${tokenHash}
      ${lockClause}
    `);
    return rows[0] ?? null;
  }

  private isUsablePasswordRecoveryToken(token: PasswordRecoveryTokenRecord, now: Date): boolean {
    return (
      token.consumedAt === null &&
      token.invalidatedAt === null &&
      token.expiresAt > now &&
      token.userStatus === "ACTIVE" &&
      token.userDeletedAt === null &&
      token.userEmailVerifiedAt !== null &&
      token.credentialVersionSnapshot === token.userCredentialVersion &&
      token.emailVerificationVersionSnapshot === token.userEmailVerificationVersion
    );
  }

  private async lockClaimedOutbox(
    transaction: Prisma.TransactionClient,
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    kind: NotificationOutboxKind,
  ): Promise<OutboxRecord | null> {
    const rows = await transaction.$queryRaw<OutboxRecord[]>(Prisma.sql`
      SELECT
        "id", "kind", "userId", "destinationAddress", "emailVersionSnapshot", "credentialVersionSnapshot",
        "status", "attemptCount", "leaseUntil", "claimedBy"
      FROM "NotificationOutbox"
      WHERE "id" = ${claim.id}
      FOR UPDATE
    `);
    const outbox = rows[0] ?? null;
    if (
      outbox === null ||
      outbox.kind !== kind ||
      outbox.status !== "PROCESSING" ||
      outbox.claimedBy !== workerId ||
      outbox.leaseUntil === null ||
      outbox.leaseUntil <= now ||
      outbox.destinationAddress === null
    ) {
      return null;
    }
    return outbox;
  }

  private async cancelOutbox(transaction: Prisma.TransactionClient, outboxId: string, now: Date): Promise<void> {
    await transaction.notificationOutbox.update({
      where: { id: outboxId },
      data: {
        status: "CANCELLED",
        destinationAddress: null,
        claimedBy: null,
        leaseUntil: null,
        terminalAt: now,
        lastErrorCode: "RECIPIENT_STATE_CHANGED",
      },
    });
  }
}
