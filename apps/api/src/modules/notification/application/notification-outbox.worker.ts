import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { EnvironmentVariables } from "../../../config/environment";
import { makePasswordRecoveryUrl, makeUserInvitationUrl, makeVerificationUrl } from "../notification.url";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  NOTIFICATION_IDLE_POLL_MS,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_MAX_ATTEMPTS,
  PASSWORD_RECOVERY_TOKEN_TTL_MS,
  USER_INVITATION_TOKEN_TTL_MS,
} from "../notification.constants";
import { EMAIL_NOTIFIER, type EmailNotifier, notificationErrorCode } from "./email-notifier";
import {
  RECOVERY_CHANNEL_REPOSITORY,
  type NotificationOutboxClaim,
  type RecoveryChannelRepository,
} from "./recovery-channel.repository";
import {
  USER_INVITATION_REPOSITORY,
  type UserInvitationOutboxClaim,
  type UserInvitationRepository,
} from "./user-invitation.repository";

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
    @Optional()
    @Inject(USER_INVITATION_REPOSITORY)
    private readonly userInvitationRepository?: UserInvitationRepository,
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
    const leaseUntil = new Date(now.getTime() + NOTIFICATION_LEASE_MS);
    const claim = await (
      this.repository.claimDueNotification !== undefined
        ? this.repository.claimDueNotification(this.workerId, now, leaseUntil)
        : this.repository.claimDueEmailVerification(this.workerId, now, leaseUntil)
    );
    if (claim !== null) return this.processRecoveryChannelClaim(claim);
    if (this.userInvitationRepository === undefined) return false;

    const invitationClaim = await this.userInvitationRepository.claimDueUserInvitation(this.workerId, now, leaseUntil);
    if (invitationClaim === null) return false;
    return this.processUserInvitationClaim(invitationClaim);
  }

  private async processRecoveryChannelClaim(claim: NotificationOutboxClaim): Promise<boolean> {
    try {
      if (claim.kind === "PASSWORD_RECOVERY") {
        const recoveryDelivery = await this.repository.preparePasswordRecoveryDelivery(
          claim,
          this.workerId,
          new Date(),
          new Date(Date.now() + PASSWORD_RECOVERY_TOKEN_TTL_MS),
        );
        if (recoveryDelivery === null) return true;
        await this.notifier.sendPasswordRecovery({
          destinationAddress: recoveryDelivery.destinationAddress,
          expiresAt: recoveryDelivery.expiresAt,
          recoveryUrl: makePasswordRecoveryUrl(
            this.configService.get("PUBLIC_WEB_BASE_URL", { infer: true }),
            recoveryDelivery.rawToken,
          ),
        });
      } else if (claim.kind === "PASSWORD_RESET_COMPLETED") {
        const completedDelivery = await this.repository.preparePasswordResetCompletedDelivery(
          claim,
          this.workerId,
          new Date(),
        );
        if (completedDelivery === null) return true;
        await this.notifier.sendPasswordResetCompleted(completedDelivery);
      } else if (
        claim.kind === "PASSKEY_REGISTERED" ||
        claim.kind === "PASSKEY_MFA_ENABLED" ||
        claim.kind === "PASSKEY_MFA_DISABLED" ||
        claim.kind === "AUTHENTICATORS_RESET_BY_RECOVERY"
      ) {
        const delivery = await this.repository.prepareSecurityNotificationDelivery(
          claim,
          this.workerId,
          new Date(),
        );
        if (delivery === null) return true;
        await this.notifier.sendSecurityNotification(delivery);
      } else {
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
      }
      await this.repository.markEmailVerificationSent(claim.id, this.workerId, new Date());
    } catch (error: unknown) {
      const code = notificationErrorCode(error);
      const nextAttemptAt = this.nextAttemptAt(claim.attemptCount, new Date());
      await this.repository.markEmailVerificationFailed(claim, this.workerId, new Date(), code, nextAttemptAt);
      this.logger.warn(`Notification delivery deferred with ${code}.`);
    }
    return true;
  }

  private async processUserInvitationClaim(claim: UserInvitationOutboxClaim): Promise<boolean> {
    if (this.userInvitationRepository === undefined) return false;
    try {
      const delivery = await this.userInvitationRepository.prepareUserInvitationDelivery(
        claim,
        this.workerId,
        new Date(),
        new Date(Date.now() + USER_INVITATION_TOKEN_TTL_MS),
      );
      if (delivery === null) return true;
      await this.notifier.sendUserInvitation({
        destinationAddress: delivery.destinationAddress,
        expiresAt: delivery.expiresAt,
        invitationUrl: makeUserInvitationUrl(
          this.configService.get("PUBLIC_WEB_BASE_URL", { infer: true }),
          delivery.rawToken,
        ),
      });
      await this.userInvitationRepository.markUserInvitationSent(claim.id, this.workerId, new Date());
    } catch (error: unknown) {
      const code = notificationErrorCode(error);
      const nextAttemptAt = this.nextAttemptAt(claim.attemptCount, new Date());
      await this.userInvitationRepository.markUserInvitationFailed(
        claim,
        this.workerId,
        new Date(),
        code,
        nextAttemptAt,
      );
      this.logger.warn(`Invitation delivery deferred with ${code}.`);
    }
    return true;
  }

  private nextAttemptAt(attemptCount: number, now: Date): Date | null {
    if (attemptCount >= NOTIFICATION_MAX_ATTEMPTS) return null;
    const exponentialBackoffMs = 1_000 * 2 ** Math.max(0, attemptCount - 1);
    const jitterMs = Math.floor(Math.random() * 250);
    return new Date(now.getTime() + exponentialBackoffMs + jitterMs);
  }
}
