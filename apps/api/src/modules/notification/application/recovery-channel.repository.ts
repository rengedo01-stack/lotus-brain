export type NotificationOutboxClaim = {
  attemptCount: number;
  credentialVersionSnapshot: number | null;
  destinationAddress: string | null;
  emailVersionSnapshot: number;
  id: string;
  kind: "EMAIL_VERIFICATION" | "PASSWORD_RECOVERY" | "PASSWORD_RESET_COMPLETED";
  userId: string;
};

export type PreparedEmailVerificationDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  rawToken: string;
};

export type PreparedPasswordRecoveryDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  rawToken: string;
};

export type PreparedPasswordResetCompletedDelivery = {
  destinationAddress: string;
};

export type PasswordResetPreparation = {
  passwordHash: string;
};

export type CompletePasswordResetInput = {
  passwordHash: string;
  tokenHash: string;
};

export interface RecoveryChannelRepository {
  requestEmailVerification(userId: string): Promise<void>;
  confirmEmailVerification(tokenHash: string): Promise<void>;
  requestPasswordRecovery(canonicalEmail: string): Promise<void>;
  preparePasswordReset(tokenHash: string): Promise<PasswordResetPreparation | null>;
  completePasswordReset(input: CompletePasswordResetInput): Promise<void>;
  claimDueEmailVerification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null>;
  prepareEmailVerificationDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedEmailVerificationDelivery | null>;
  preparePasswordRecoveryDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<PreparedPasswordRecoveryDelivery | null>;
  preparePasswordResetCompletedDelivery(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
  ): Promise<PreparedPasswordResetCompletedDelivery | null>;
  markEmailVerificationSent(outboxId: string, workerId: string, now: Date): Promise<void>;
  markEmailVerificationFailed(
    claim: NotificationOutboxClaim,
    workerId: string,
    now: Date,
    errorCode: string,
    nextAttemptAt: Date | null,
  ): Promise<void>;
  claimDueNotification(workerId: string, now: Date, leaseUntil: Date): Promise<NotificationOutboxClaim | null>;
}

export const RECOVERY_CHANNEL_REPOSITORY = Symbol("RECOVERY_CHANNEL_REPOSITORY");
