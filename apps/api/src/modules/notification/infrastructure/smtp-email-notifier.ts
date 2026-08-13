import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { EnvironmentVariables } from "../../../config/environment";
import {
  NotificationDeliveryError,
  type EmailNotifier,
  type EmailVerificationDelivery,
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
