import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EnvironmentVariables } from "../../../config/environment";
import {
  NotificationDeliveryError,
  type EmailNotifier,
  type EmailVerificationDelivery,
  type PasswordRecoveryDelivery,
  type PasswordResetCompletedDelivery,
  type SecurityNotificationDelivery,
  type UserInvitationDelivery,
} from "../application/email-notifier";

@Injectable()
export class SmtpEmailNotifier implements EmailNotifier {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const host = configService.get("SMTP_HOST", { infer: true });
    const user = configService.get("SMTP_USER", { infer: true });
    const password = configService.get("SMTP_PASSWORD", { infer: true });
    const from = configService.get("SMTP_FROM", { infer: true });
    if (host === undefined || user === undefined || password === undefined || from === undefined) {
      throw new Error("Production SMTP configuration is required.");
    }
    this.from = from;
    this.transporter = nodemailer.createTransport({
      host,
      port: configService.get("SMTP_PORT", { infer: true }),
      secure: configService.get("SMTP_SECURE", { infer: true }),
      requireTLS: true,
      auth: { user, pass: password },
      tls: { rejectUnauthorized: true },
      logger: false,
      debug: false,
    });
  }

  async sendEmailVerification(delivery: EmailVerificationDelivery): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: delivery.destinationAddress,
        subject: "Verify your Lotus BRAIN email address",
        text: [
          "Verify the email address for your Lotus BRAIN account.",
          "",
          delivery.verificationUrl,
          "",
          `This link expires at ${delivery.expiresAt.toISOString()}.`,
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
      });
    } catch (error: unknown) {
      throw new NotificationDeliveryError(this.classifyError(error));
    }
  }

  async sendPasswordRecovery(delivery: PasswordRecoveryDelivery): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: delivery.destinationAddress,
        subject: "Reset your Lotus BRAIN password",
        text: [
          "A password reset was requested for your Lotus BRAIN account.",
          "",
          delivery.recoveryUrl,
          "",
          `This link expires at ${delivery.expiresAt.toISOString()}.`,
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
      });
    } catch (error: unknown) {
      throw new NotificationDeliveryError(this.classifyError(error));
    }
  }

  async sendPasswordResetCompleted(delivery: PasswordResetCompletedDelivery): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: delivery.destinationAddress,
        subject: "Your Lotus BRAIN password was reset",
        text: [
          "Your Lotus BRAIN password was reset successfully.",
          "",
          "If you did not make this change, contact your operator or support immediately.",
        ].join("\n"),
      });
    } catch (error: unknown) {
      throw new NotificationDeliveryError(this.classifyError(error));
    }
  }

  async sendUserInvitation(delivery: UserInvitationDelivery): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: delivery.destinationAddress,
        subject: "You have been invited to Lotus BRAIN",
        text: [
          "You have been invited to create your Lotus BRAIN account.",
          "",
          delivery.invitationUrl,
          "",
          `This link expires at ${delivery.expiresAt.toISOString()}.`,
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
      });
    } catch (error: unknown) {
      throw new NotificationDeliveryError(this.classifyError(error));
    }
  }

  async sendSecurityNotification(delivery: SecurityNotificationDelivery): Promise<void> {
    const content = this.securityNotificationContent(delivery.kind);
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: delivery.destinationAddress,
        subject: content.subject,
        text: content.text,
      });
    } catch (error: unknown) {
      throw new NotificationDeliveryError(this.classifyError(error));
    }
  }

  private securityNotificationContent(kind: SecurityNotificationDelivery["kind"]): { subject: string; text: string } {
    switch (kind) {
      case "PASSKEY_REGISTERED":
        return {
          subject: "A passkey was added to your Lotus BRAIN account",
          text: "A passkey was registered for your Lotus BRAIN account. If you did not make this change, contact your operator or support immediately.",
        };
      case "PASSKEY_MFA_ENABLED":
        return {
          subject: "Passkey MFA was enabled for your Lotus BRAIN account",
          text: "Password plus passkey MFA was enabled for your Lotus BRAIN account. Existing sessions were signed out.",
        };
      case "PASSKEY_MFA_DISABLED":
        return {
          subject: "Passkey MFA was disabled for your Lotus BRAIN account",
          text: "Password plus passkey MFA was disabled for your Lotus BRAIN account. Existing sessions were signed out.",
        };
      case "AUTHENTICATORS_RESET_BY_RECOVERY":
        return {
          subject: "Your Lotus BRAIN passkeys and MFA were reset",
          text: "Password recovery reset passkey MFA and revoked all registered passkeys. If you did not make this change, contact your operator or support immediately.",
        };
    }
  }

  private classifyError(error: unknown): NotificationDeliveryError["code"] {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (["EAUTH", "535"].includes(code)) return "AUTH_FAILURE";
    if (["ETIMEDOUT", "ESOCKET", "ECONNRESET"].includes(code)) return "TIMEOUT";
    if (["ECONNECTION", "ECONNREFUSED", "ENOTFOUND"].includes(code)) return "CONNECTION_FAILURE";
    if (["EENVELOPE", "EMESSAGE"].includes(code)) return "RECIPIENT_REJECTED";
    return "UNKNOWN";
  }
}
