export type EmailVerificationDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  verificationUrl: string;
};

export type PasswordRecoveryDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  recoveryUrl: string;
};

export type PasswordResetCompletedDelivery = {
  destinationAddress: string;
};

export type UserInvitationDelivery = {
  destinationAddress: string;
  expiresAt: Date;
  invitationUrl: string;
};

export type SecurityNotificationDelivery = {
  destinationAddress: string;
  kind: "PASSKEY_REGISTERED" | "PASSKEY_MFA_ENABLED" | "PASSKEY_MFA_DISABLED" | "AUTHENTICATORS_RESET_BY_RECOVERY";
};

export interface EmailNotifier {
  sendEmailVerification(delivery: EmailVerificationDelivery): Promise<void>;
  sendPasswordRecovery(delivery: PasswordRecoveryDelivery): Promise<void>;
  sendPasswordResetCompleted(delivery: PasswordResetCompletedDelivery): Promise<void>;
  sendUserInvitation(delivery: UserInvitationDelivery): Promise<void>;
  sendSecurityNotification(delivery: SecurityNotificationDelivery): Promise<void>;
}

export const EMAIL_NOTIFIER = Symbol("EMAIL_NOTIFIER");

export class NotificationDeliveryError extends Error {
  constructor(readonly code: "AUTH_FAILURE" | "CONNECTION_FAILURE" | "RECIPIENT_REJECTED" | "TIMEOUT" | "UNKNOWN") {
    super("Notification delivery failed.");
  }
}

export function notificationErrorCode(error: unknown): NotificationDeliveryError["code"] {
  if (error instanceof NotificationDeliveryError) return error.code;
  return "UNKNOWN";
}
