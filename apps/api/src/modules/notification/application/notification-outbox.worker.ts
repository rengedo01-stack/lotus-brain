import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { EnvironmentVariables } from "../../../config/environment";
import { makeVerificationUrl } from "../notification.url";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  NOTIFICATION_IDLE_POLL_MS,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_MAX_ATTEMPTS,
} from "../notification.constants";
import { EMAIL_NOTIFIER, type EmailNotifier, notificationErrorCode } from "./email-notifier";
import {
  RECOVERY_CHANNEL_REPOSITORY,
  type NotificationOutboxClaim,
  type RecoveryChannelRepository,
} from "./recovery-channel.repository";

@Injectable()
export class NotificationOutboxWorker {
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private readonly workerId = `notification-worker-${randomUUID()}`;
  private stopping = false;

  constructor(
    @Inject(RECOVERY_CHANNEL_REPOSITORY)
    private readonly repository: RecoveryChannelRepository,
    @Inject(EMAIL_NOTIFIER)
    private readonly notifier: EmailNotifier,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async runUntilStopped(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.processOne();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, NOTIFICATION_IDLE_POLL_MS));
    }
  }

  async processOne(now = new Date()): Promise<boolean> {
    const claim = await this.repository.claimDueEmailVerification(
      this.workerId,
      now,
      new Date(now.getTime() + NOTIFICATION_LEASE_MS),
    );
    if (claim === null) return false;

    try {
      const delivery = await this.repository.prepareEmailVerificationDelivery(
        claim,
        this.workerId,
        new Date(),
        new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
      );
      if (delivery === null) return true;

      const verificationUrl = makeVerificationUrl(
        this.configService.get("PUBLIC_WEB_BASE_URL", { infer: true }),
        delivery.rawToken,
      );
      await this.notifier.sendEmailVerification({
        destinationAddress: delivery.destinationAddress,
        expiresAt: delivery.expiresAt,
        verificationUrl,
      });
      await this.repository.markEmailVerificationSent(claim.id, this.workerId, new Date());
    } catch (error: unknown) {
      const code = notificationErrorCode(error);
      const nextAttemptAt = this.nextAttemptAt(claim, new Date());
      await this.repository.markEmailVerificationFailed(claim, this.workerId, new Date(), code, nextAttemptAt);
      this.logger.warn(`Email verification delivery deferred with ${code}.`);
    }
    return true;
  }

  private nextAttemptAt(claim: NotificationOutboxClaim, now: Date): Date | null {
    if (claim.attemptCount >= NOTIFICATION_MAX_ATTEMPTS) return null;
    const exponentialBackoffMs = 1_000 * 2 ** Math.max(0, claim.attemptCount - 1);
    const jitterMs = Math.floor(Math.random() * 250);
    return new Date(now.getTime() + exponentialBackoffMs + jitterMs);
  }
}
