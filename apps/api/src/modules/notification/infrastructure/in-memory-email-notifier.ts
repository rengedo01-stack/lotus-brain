import { Injectable } from "@nestjs/common";
import type { EmailNotifier, EmailVerificationDelivery } from "../application/email-notifier";

/**
 * Explicit non-production transport. It deliberately emits no console output,
 * so verification credentials never become an application-log fallback.
 */
@Injectable()
export class InMemoryEmailNotifier implements EmailNotifier {
  readonly deliveries: EmailVerificationDelivery[] = [];

  async sendEmailVerification(delivery: EmailVerificationDelivery): Promise<void> {
    this.deliveries.push({ ...delivery });
  }
}
