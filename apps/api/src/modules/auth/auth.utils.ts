import { createHash, randomBytes } from "node:crypto";
import {
  MFA_PREAUTH_COOKIE_NAME,
  MFA_PREAUTH_COOKIE_NAME_INSECURE,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME_INSECURE,
} from "./auth.constants";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function makeOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secondsFromDays(days: number): number {
  return days * 24 * 60 * 60;
}

export function makeSessionCookieName(isProduction: boolean): string {
  return isProduction ? SESSION_COOKIE_NAME : SESSION_COOKIE_NAME_INSECURE;
}

export function makeMfaPreauthCookieName(isProduction: boolean): string {
  return isProduction ? MFA_PREAUTH_COOKIE_NAME : MFA_PREAUTH_COOKIE_NAME_INSECURE;
}
