import { Injectable } from "@nestjs/common";
import { Prisma, type NotificationOutboxStatus, type UserStatus } from "../../../generated/prisma/client";
import { makeOpaqueToken, hashSecret } from "../../auth/auth.utils";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  EMAIL_VERIFICATION_REQUEST_COOLDOWN_MS,
} from "../notification.constants";
import { EmailVerificationTokenInvalidError } from "../application/recovery-channel.errors";
import type {
  NotificationOutboxClaim,
  PreparedEmailVerificationDelivery,
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

type OutboxRecord = {
  attemptCount: number;
  claimedBy: string | null;
  destinationAddress: string | null;
  emailVersionSnapshot: number;
  id: string;
  leaseUntil: Date | null;
  status: NotificationOutboxStatus;
  userId: string;
};

type VerificationUserRecord = {
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
      const users = await transaction.$queryRaw<VerificationUserRecord[]>(Prisma.sql`
        SELECT "id", "email", "emailVerifiedAt", "emailVerificationVersion", "status", "deletedAt"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `);
      const user = users[0] ?? null;
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

  async claimDueEmailVerification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null> {
    const claimed = await this.prisma.$queryRaw<NotificationOutboxClaim[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE "kind" = 'EMAIL_VERIFICATION'::"NotificationOutboxKind"
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
        "outbox"."userId",
        "outbox"."destinationAddress",
        "outbox"."emailVersionSnapshot",
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
      const outboxRows = await transaction.$queryRaw<OutboxRecord[]>(Prisma.sql`
        SELECT
          "id", "userId", "destinationAddress", "emailVersionSnapshot", "status",
          "attemptCount", "leaseUntil", "claimedBy"
        FROM "NotificationOutbox"
        WHERE "id" = ${claim.id}
        FOR UPDATE
      `);
      const outbox = outboxRows[0] ?? null;
      if (
        outbox === null ||
        outbox.status !== "PROCESSING" ||
        outbox.claimedBy !== workerId ||
        outbox.leaseUntil === null ||
        outbox.leaseUntil <= now ||
        outbox.destinationAddress === null
      ) {
        return null;
      }

      const users = await transaction.$queryRaw<VerificationUserRecord[]>(Prisma.sql`
        SELECT "id", "email", "emailVerifiedAt", "emailVerificationVersion", "status", "deletedAt"
        FROM "User"
        WHERE "id" = ${outbox.userId}
        FOR UPDATE
      `);
      const user = users[0] ?? null;
      if (
        user === null ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.emailVerifiedAt !== null ||
        user.email !== outbox.destinationAddress ||
        user.emailVerificationVersion !== outbox.emailVersionSnapshot
      ) {
        await transaction.notificationOutbox.update({
          where: { id: outbox.id },
          data: {
            status: "CANCELLED",
            destinationAddress: null,
            claimedBy: null,
            leaseUntil: null,
            terminalAt: now,
            lastErrorCode: "RECIPIENT_STATE_CHANGED",
          },
        });
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
}
