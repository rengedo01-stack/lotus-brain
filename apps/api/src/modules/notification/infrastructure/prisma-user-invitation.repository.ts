import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { hashSecret, makeOpaqueToken } from "../../auth/auth.utils";
import {
  USER_INVITATION_RESEND_COOLDOWN_MS,
} from "../notification.constants";
import {
  UserInvitationConflictError,
  UserInvitationCredentialInvalidError,
  UserInvitationNotFoundError,
} from "../application/user-invitation.errors";
import type {
  ListUserInvitationsQuery,
  PreparedUserInvitationDelivery,
  UserInvitationOutboxClaim,
  UserInvitationRepository,
  UserInvitationView,
} from "../application/user-invitation.repository";

type InvitationRecord = UserInvitationView & { createdByUserId: string };

type InvitationTokenRecord = {
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  invitationId: string;
  invalidatedAt: Date | null;
};

type InvitationOutboxRecord = {
  attemptCount: number;
  claimedBy: string | null;
  destinationAddress: string | null;
  id: string;
  invitationId: string | null;
  leaseUntil: Date | null;
  status: "PENDING" | "PROCESSING" | "SENT" | "DEAD" | "CANCELLED";
};

const invitationSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  acceptedAt: true,
  cancelledAt: true,
  createdByUserId: true,
} as const;

@Injectable()
export class PrismaUserInvitationRepository implements UserInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createInvitation(input: { actorUserId: string; email: string }): Promise<UserInvitationView> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existingUser = await transaction.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existingUser !== null) {
          throw new UserInvitationConflictError("An identity already exists for this email address.");
        }

        const pending = await transaction.userInvitation.findFirst({
          where: { email: input.email, status: "PENDING" },
          select: { id: true },
        });
        if (pending !== null) {
          throw new UserInvitationConflictError("A pending invitation already exists for this email address.");
        }

        const invitation = await transaction.userInvitation.create({
          data: {
            email: input.email,
            status: "PENDING",
            createdByUserId: input.actorUserId,
          },
          select: invitationSelect,
        });
        await transaction.notificationOutbox.create({
          data: {
            kind: "USER_INVITATION",
            userId: null,
            invitationId: invitation.id,
            destinationAddress: invitation.email,
            emailVersionSnapshot: null,
            credentialVersionSnapshot: null,
          },
        });
        await transaction.identityAuditLog.create({
          data: {
            action: "USER_INVITATION_CREATED",
            actorUserId: input.actorUserId,
            targetUserId: null,
            afterState: { invitationId: invitation.id, email: invitation.email, status: invitation.status },
          },
        });
        return this.toView(invitation);
      });
    } catch (error: unknown) {
      if (this.isPrismaError(error, "P2002")) {
        throw new UserInvitationConflictError("A pending invitation already exists for this email address.");
      }
      throw error;
    }
  }

  async listInvitations(query: ListUserInvitationsQuery): Promise<UserInvitationView[]> {
    const invitations = await this.prisma.userInvitation.findMany({
      where: { status: query.status },
      select: invitationSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return invitations.map((invitation) => this.toView(invitation));
  }

  async getInvitation(invitationId: string): Promise<UserInvitationView> {
    const invitation = await this.prisma.userInvitation.findUnique({
      where: { id: invitationId },
      select: invitationSelect,
    });
    if (invitation === null) throw new UserInvitationNotFoundError("Invitation was not found.");
    return this.toView(invitation);
  }

  async cancelInvitation(invitationId: string, actorUserId: string): Promise<UserInvitationView> {
    return this.prisma.$transaction(async (transaction) => {
      const invitation = await this.lockInvitation(transaction, invitationId);
      if (invitation.status !== "PENDING") {
        throw new UserInvitationConflictError("Only pending invitations can be cancelled.");
      }

      const now = new Date();
      const cancelled = await transaction.userInvitation.update({
        where: { id: invitation.id },
        data: { status: "CANCELLED", cancelledAt: now },
        select: invitationSelect,
      });
      await transaction.userInvitationToken.updateMany({
        where: { invitationId: invitation.id, consumedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      await transaction.notificationOutbox.updateMany({
        where: {
          invitationId: invitation.id,
          kind: "USER_INVITATION",
          status: { in: ["PENDING", "PROCESSING"] },
        },
        data: {
          status: "CANCELLED",
          destinationAddress: null,
          claimedBy: null,
          leaseUntil: null,
          terminalAt: now,
          lastErrorCode: "INVITATION_CANCELLED",
        },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "USER_INVITATION_CANCELLED",
          actorUserId,
          targetUserId: null,
          beforeState: this.auditState(invitation),
          afterState: this.auditState(cancelled),
        },
      });
      return this.toView(cancelled);
    });
  }

  async resendInvitation(invitationId: string, actorUserId: string): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      const invitation = await this.lockInvitation(transaction, invitationId);
      if (invitation.status !== "PENDING") {
        throw new UserInvitationConflictError("Only pending invitations can be resent.");
      }
      if (await this.userExists(transaction, invitation.email)) {
        throw new UserInvitationConflictError("An identity already exists for this invitation email address.");
      }

      const recentlyQueued = await transaction.notificationOutbox.findFirst({
        where: {
          kind: "USER_INVITATION",
          invitationId: invitation.id,
          createdAt: { gte: new Date(Date.now() - USER_INVITATION_RESEND_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (recentlyQueued !== null) {
        throw new UserInvitationConflictError("This invitation was sent recently.");
      }

      await transaction.notificationOutbox.create({
        data: {
          kind: "USER_INVITATION",
          userId: null,
          invitationId: invitation.id,
          destinationAddress: invitation.email,
          emailVersionSnapshot: null,
          credentialVersionSnapshot: null,
        },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "USER_INVITATION_RESENT",
          actorUserId,
          targetUserId: null,
          beforeState: this.auditState(invitation),
          afterState: { invitationId: invitation.id, resendQueued: true },
        },
      });
    });
  }

  async acceptInvitation(input: { passwordHash: string; tokenHash: string }): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const tokenReference = await transaction.userInvitationToken.findUnique({
          where: { tokenHash: input.tokenHash },
          select: { invitationId: true },
        });
        if (tokenReference === null) throw this.invalidCredential();

        // All lifecycle paths lock the invitation before invitation-token or
        // outbox state, which serializes acceptance with cancel and resend.
        const invitation = await this.lockInvitation(transaction, tokenReference.invitationId);
        const token = await this.lockInvitationToken(transaction, input.tokenHash);
        const now = new Date();
        if (
          token === null ||
          token.invitationId !== invitation.id ||
          token.consumedAt !== null ||
          token.invalidatedAt !== null ||
          token.expiresAt <= now ||
          invitation.status !== "PENDING" ||
          await this.userExists(transaction, invitation.email)
        ) {
          throw this.invalidCredential();
        }

        // The existing email-generation trigger permits a verified insert only
        // after this accepted invitation state is established in this same
        // transaction. Any later failure rolls all of these writes back.
        await transaction.userInvitationToken.update({
          where: { id: token.id },
          data: { consumedAt: now },
        });
        await transaction.userInvitationToken.updateMany({
          where: {
            invitationId: invitation.id,
            id: { not: token.id },
            consumedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        await transaction.userInvitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED", acceptedAt: now },
        });
        await transaction.notificationOutbox.updateMany({
          where: {
            invitationId: invitation.id,
            kind: "USER_INVITATION",
            status: { in: ["PENDING", "PROCESSING"] },
          },
          data: {
            status: "CANCELLED",
            destinationAddress: null,
            claimedBy: null,
            leaseUntil: null,
            terminalAt: now,
            lastErrorCode: "INVITATION_ACCEPTED",
          },
        });
        const user = await transaction.user.create({
          data: {
            email: invitation.email,
            displayName: invitation.email,
            passwordHash: input.passwordHash,
            emailVerifiedAt: now,
          },
          select: { id: true },
        });
        await transaction.identityAuditLog.create({
          data: {
            action: "USER_INVITATION_ACCEPTED",
            actorUserId: null,
            targetUserId: user.id,
            beforeState: this.auditState(invitation),
            afterState: { invitationId: invitation.id, status: "ACCEPTED", emailVerified: true },
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof UserInvitationCredentialInvalidError || this.isPrismaError(error, "P2002")) {
        throw this.invalidCredential();
      }
      throw error;
    }
  }

  async claimDueUserInvitation(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<UserInvitationOutboxClaim | null> {
    const claimed = await this.prisma.$queryRaw<UserInvitationOutboxClaim[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "NotificationOutbox"
        WHERE "kind" = 'USER_INVITATION'::"NotificationOutboxKind"
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
        "outbox"."invitationId",
        "outbox"."destinationAddress",
        "outbox"."attemptCount"
    `);
    const claim = claimed[0] ?? null;
    if (claim === null || claim.invitationId === null) return null;
    return { ...claim, invitationId: claim.invitationId };
  }

  async prepareUserInvitationDelivery(
    claim: UserInvitationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedUserInvitationDelivery | null> {
    return this.prisma.$transaction(async (transaction) => {
      const invitation = await this.lockInvitation(transaction, claim.invitationId);
      if (invitation.status !== "PENDING" || await this.userExists(transaction, invitation.email)) {
        await this.cancelClaimedOutbox(transaction, claim.id, workerId, now, "INVITATION_STATE_CHANGED");
        return null;
      }
      const outbox = await this.lockClaimedOutbox(transaction, claim.id, workerId, now);
      if (outbox === null || outbox.invitationId !== invitation.id || outbox.destinationAddress !== invitation.email) {
        return null;
      }

      const rawToken = makeOpaqueToken();
      await transaction.userInvitationToken.create({
        data: {
          invitationId: invitation.id,
          tokenHash: hashSecret(rawToken),
          expiresAt,
        },
      });
      return { destinationAddress: invitation.email, expiresAt, rawToken };
    });
  }

  async markUserInvitationSent(outboxId: string, workerId: string, now: Date): Promise<void> {
    await this.prisma.notificationOutbox.updateMany({
      where: { id: outboxId, status: "PROCESSING", claimedBy: workerId, kind: "USER_INVITATION" },
      data: {
        status: "SENT",
        destinationAddress: null,
        claimedBy: null,
        leaseUntil: null,
        sentAt: now,
      },
    });
  }

  async markUserInvitationFailed(
    claim: UserInvitationOutboxClaim,
    workerId: string,
    now: Date,
    errorCode: string,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const outbox = await this.lockClaimedOutbox(transaction, claim.id, workerId, now, false);
      if (outbox === null) return;
      await transaction.notificationOutbox.update({
        where: { id: outbox.id },
        data: nextAttemptAt === null
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

  private async lockInvitation(transaction: Prisma.TransactionClient, invitationId: string): Promise<InvitationRecord> {
    const invitations = await transaction.$queryRaw<InvitationRecord[]>(Prisma.sql`
      SELECT "id", "email", "status", "createdByUserId", "createdAt", "acceptedAt", "cancelledAt"
      FROM "UserInvitation"
      WHERE "id" = ${invitationId}
      FOR UPDATE
    `);
    const invitation = invitations[0] ?? null;
    if (invitation === null) throw new UserInvitationNotFoundError("Invitation was not found.");
    return invitation;
  }

  private async lockInvitationToken(
    transaction: Prisma.TransactionClient,
    tokenHash: string,
  ): Promise<InvitationTokenRecord | null> {
    const tokens = await transaction.$queryRaw<InvitationTokenRecord[]>(Prisma.sql`
      SELECT "id", "invitationId", "expiresAt", "consumedAt", "invalidatedAt"
      FROM "UserInvitationToken"
      WHERE "tokenHash" = ${tokenHash}
      FOR UPDATE
    `);
    return tokens[0] ?? null;
  }

  private async userExists(transaction: Prisma.TransactionClient, email: string): Promise<boolean> {
    const user = await transaction.user.findUnique({ where: { email }, select: { id: true } });
    return user !== null;
  }

  private async lockClaimedOutbox(
    transaction: Prisma.TransactionClient,
    outboxId: string,
    workerId: string,
    now: Date,
    requireUnexpiredLease = true,
  ): Promise<InvitationOutboxRecord | null> {
    const outboxes = await transaction.$queryRaw<InvitationOutboxRecord[]>(Prisma.sql`
      SELECT "id", "invitationId", "destinationAddress", "status", "attemptCount", "claimedBy", "leaseUntil"
      FROM "NotificationOutbox"
      WHERE "id" = ${outboxId}
      FOR UPDATE
    `);
    const outbox = outboxes[0] ?? null;
    if (
      outbox === null ||
      outbox.status !== "PROCESSING" ||
      outbox.claimedBy !== workerId ||
      outbox.invitationId === null ||
      outbox.destinationAddress === null ||
      (requireUnexpiredLease && (outbox.leaseUntil === null || outbox.leaseUntil <= now))
    ) {
      return null;
    }
    return outbox;
  }

  private async cancelClaimedOutbox(
    transaction: Prisma.TransactionClient,
    outboxId: string,
    workerId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await transaction.notificationOutbox.updateMany({
      where: { id: outboxId, kind: "USER_INVITATION", status: "PROCESSING", claimedBy: workerId },
      data: {
        status: "CANCELLED",
        destinationAddress: null,
        claimedBy: null,
        leaseUntil: null,
        terminalAt: now,
        lastErrorCode: reason,
      },
    });
  }

  private toView(invitation: InvitationRecord): UserInvitationView {
    return {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      createdAt: invitation.createdAt,
      acceptedAt: invitation.acceptedAt,
      cancelledAt: invitation.cancelledAt,
    };
  }

  private auditState(invitation: Pick<InvitationRecord, "id" | "email" | "status" | "acceptedAt" | "cancelledAt">) {
    return {
      invitationId: invitation.id,
      email: invitation.email,
      status: invitation.status,
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      cancelledAt: invitation.cancelledAt?.toISOString() ?? null,
    };
  }

  private invalidCredential(): UserInvitationCredentialInvalidError {
    return new UserInvitationCredentialInvalidError("Invitation credential is invalid or expired.");
  }

  private isPrismaError(error: unknown, code: string): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === code;
  }
}
