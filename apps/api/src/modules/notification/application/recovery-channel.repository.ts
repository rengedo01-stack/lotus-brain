export type NotificationOutboxClaim = {
  attemptCount: number;
  destinationAddress: string | null;
  emailVersionSnapshot: number;
  id: string;
  userId: string;
};

export type PreparedEmailVerificationDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  rawToken: string;
};

export interface RecoveryChannelRepository {
  requestEmailVerification(userId: string): Promise<void>;
  confirmEmailVerification(tokenHash: string): Promise<void>;
  claimDueEmailVerification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null>;
  prepareEmailVerificationDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedEmailVerificationDelivery | null>;
  markEmailVerificationSent(outboxId: string, workerId: string, now: Date): Promise<void>;
  markEmailVerificationFailed(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    errorCode: string,
    nextAttemptAt: Date | null,
  ): Promise<void>;
}

export const RECOVERY_CHANNEL_REPOSITORY = Symbol("RECOVERY_CHANNEL_REPOSITORY");
