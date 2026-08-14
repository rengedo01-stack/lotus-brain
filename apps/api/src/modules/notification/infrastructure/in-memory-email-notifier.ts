import { Injectable } from "@nestjs/common";
import type {
  EmailNotifier,
  EmailVerificationDelivery,
  PasswordRecoveryDelivery,
  PasswordResetCompletedDelivery,
  SecurityNotificationDelivery,
  UserInvitationDelivery,
} from "../application/email-notifier";

/**
 * Explicit non-production transport. It deliberately emits no console output,
 * so verification credentials never become an application-log fallback.
 */
@Injectable()
export class InMemoryEmailNotifier implements EmailNotifier {
  readonly deliveries: EmailVerificationDelivery[] = [];
  readonly passwordRecoveryDeliveries: PasswordRecoveryDelivery[] = [];
  readonly passwordResetCompletedDeliveries: PasswordResetCompletedDelivery[] = [];
  readonly userInvitationDeliveries: UserInvitationDelivery[] = [];
  readonly securityNotificationDeliveries: SecurityNotificationDelivery[] = [];

  async sendEmailVerification(delivery: EmailVerificationDelivery): Promise<void> {
    this.deliveries.push({ ...delivery });
  }

  async sendPasswordRecovery(delivery: PasswordRecoveryDelivery): Promise<void> {
    this.passwordRecoveryDeliveries.push({ ...delivery });
  }

  async sendPasswordResetCompleted(delivery: PasswordResetCompletedDelivery): Promise<void> {
    this.passwordResetCompletedDeliveries.push({ ...delivery });
  }

  async sendUserInvitation(delivery: UserInvitationDelivery): Promise<void> {
    this.userInvitationDeliveries.push({ ...delivery });
  }

  async sendSecurityNotification(delivery: SecurityNotificationDelivery): Promise<void> {
    this.securityNotificationDeliveries.push({ ...delivery });
  }
}
