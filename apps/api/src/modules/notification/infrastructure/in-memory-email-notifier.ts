import { Injectable } from "@nestjs/common";
import type {
  EmailNotifier,
  EmailVerificationDelivery,
  PasswordRecoveryDelivery,
  PasswordResetCompletedDelivery,
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

  async sendEmailVerification(delivery: EmailVerificationDelivery): Promise<void> {
    this.deliveries.push({ ...delivery });
  }

  async sendPasswordRecovery(delivery: PasswordRecoveryDelivery): Promise<void> {
    this.passwordRecoveryDeliveries.push({ ...delivery });
  }

  async sendPasswordResetCompleted(delivery: PasswordResetCompletedDelivery): Promise<void> {
    this.passwordResetCompletedDeliveries.push({ ...delivery });
  }
}
