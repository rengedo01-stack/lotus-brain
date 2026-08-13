import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../../config/environment";
import { PrismaModule } from "../../prisma/prisma.module";
import { EMAIL_NOTIFIER } from "./application/email-notifier";
import { EmailVerificationService } from "./application/email-verification.service";
import { PasswordRecoveryService } from "./application/password-recovery.service";
import { NotificationOutboxWorker } from "./application/notification-outbox.worker";
import { RECOVERY_CHANNEL_REPOSITORY } from "./application/recovery-channel.repository";
import { USER_INVITATION_REPOSITORY } from "./application/user-invitation.repository";
import { PrismaRecoveryChannelRepository } from "./infrastructure/prisma-recovery-channel.repository";
import { PrismaUserInvitationRepository } from "./infrastructure/prisma-user-invitation.repository";
import { InMemoryEmailNotifier } from "./infrastructure/in-memory-email-notifier";
import { SmtpEmailNotifier } from "./infrastructure/smtp-email-notifier";
import { EmailVerificationController } from "./presentation/email-verification.controller";
import { PasswordRecoveryController } from "./presentation/password-recovery.controller";

@Module({
  imports: [PrismaModule],
  controllers: [EmailVerificationController, PasswordRecoveryController],
  providers: [
    EmailVerificationService,
    PasswordRecoveryService,
    NotificationOutboxWorker,
    PrismaRecoveryChannelRepository,
    PrismaUserInvitationRepository,
    { provide: RECOVERY_CHANNEL_REPOSITORY, useExisting: PrismaRecoveryChannelRepository },
    { provide: USER_INVITATION_REPOSITORY, useExisting: PrismaUserInvitationRepository },
    {
      provide: EMAIL_NOTIFIER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        configService.get("NODE_ENV", { infer: true }) === "production"
          ? new SmtpEmailNotifier(configService)
          : new InMemoryEmailNotifier(),
    },
  ],
  exports: [
    EmailVerificationService,
    PasswordRecoveryService,
    NotificationOutboxWorker,
    RECOVERY_CHANNEL_REPOSITORY,
    USER_INVITATION_REPOSITORY,
    EMAIL_NOTIFIER,
  ],
})
export class NotificationModule {}
