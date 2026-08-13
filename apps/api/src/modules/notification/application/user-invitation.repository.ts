import type { UserInvitationStatus } from "../../../generated/prisma/client";

export const USER_INVITATION_REPOSITORY = Symbol("USER_INVITATION_REPOSITORY");

export type UserInvitationView = {
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  email: string;
  id: string;
  status: UserInvitationStatus;
};

export type ListUserInvitationsQuery = {
  limit: number;
  offset: number;
  status?: UserInvitationStatus;
};

export type UserInvitationOutboxClaim = {
  attemptCount: number;
  destinationAddress: string | null;
  id: string;
  invitationId: string;
};

export type PreparedUserInvitationDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  rawToken: string;
};

export interface UserInvitationRepository {
  createInvitation(input: { actorUserId: string; email: string }): Promise<UserInvitationView>;
  listInvitations(query: ListUserInvitationsQuery): Promise<UserInvitationView[]>;
  getInvitation(invitationId: string): Promise<UserInvitationView>;
  cancelInvitation(invitationId: string, actorUserId: string): Promise<UserInvitationView>;
  resendInvitation(invitationId: string, actorUserId: string): Promise<void>;
  acceptInvitation(input: { passwordHash: string; tokenHash: string }): Promise<void>;
  claimDueUserInvitation(workerId: string, now: Date, leaseUntil: Date): Promise<UserInvitationOutboxClaim | null>;
  prepareUserInvitationDelivery(
    claim: UserInvitationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedUserInvitationDelivery | null>;
  markUserInvitationSent(outboxId: string, workerId: string, now: Date): Promise<void>;
  markUserInvitationFailed(
    claim: UserInvitationOutboxClaim,
    workerId: string,
    now: Date,
    errorCode: string,
    nextAttemptAt: Date | null,
  ): Promise<void>;
}
