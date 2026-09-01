import type { ApiClient } from "./api-client";
import { isWebAuthnAuthenticationOptions } from "./webauthn-options.ts";

export type PasskeyMfaStatus = {
  activePasskeyCount: number;
  enabled: boolean;
  recoveryEmailVerified: boolean;
};

export type PasskeyMfaApi = Pick<ApiClient, "request">;

const PASSKEY_MFA_STATUS_KEYS = ["enabled", "activePasskeyCount", "recoveryEmailVerified"] as const;

export type PasskeyMfaAction = "enable" | "disable";

export const passkeyMfaPaths = {
  status: "/auth/mfa/passkey",
} as const;

export function passkeyMfaOptionsPath(action: PasskeyMfaAction): string {
  return `${passkeyMfaPaths.status}/${action}/options`;
}

export function passkeyMfaVerifyPath(action: PasskeyMfaAction): string {
  return `${passkeyMfaPaths.status}/${action}/verify`;
}

export function isPasskeyMfaStatus(value: unknown): value is PasskeyMfaStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const keys = Object.keys(status);
  if (keys.length !== PASSKEY_MFA_STATUS_KEYS.length || !PASSKEY_MFA_STATUS_KEYS.every((key) => key in status)) return false;
  return (
    typeof status.enabled === "boolean" &&
    typeof status.activePasskeyCount === "number" &&
    Number.isInteger(status.activePasskeyCount) &&
    status.activePasskeyCount >= 0 &&
    typeof status.recoveryEmailVerified === "boolean"
  );
}

export async function requestPasskeyMfaStatus(api: PasskeyMfaApi): Promise<PasskeyMfaStatus> {
  const payload = await api.request<unknown>(passkeyMfaPaths.status, { expectedStatus: 200 });
  if (!isPasskeyMfaStatus(payload)) throw new Error("MFA status could not be loaded.");
  return payload;
}

export function isPasskeyAuthenticationOptions(value: unknown): value is { challenge: string } {
  return isWebAuthnAuthenticationOptions(value);
}

export function isPasskeyMfaMutationResponse(value: unknown): value is { status: "ok" } {
  return (
    typeof value === "object"
    && value !== null
    && Object.keys(value).length === 1
    && (value as { status?: unknown }).status === "ok"
  );
}

export function passkeyMfaErrorMessage(error: unknown): string {
  const kind = typeof error === "object" && error !== null && "kind" in error
    ? (error as { kind?: unknown }).kind
    : undefined;
  if (kind === "conflict") return "MFAの状態が更新されています。ページを再読み込みしてから再試行してください。";
  if (kind === "forbidden") return "この操作は許可されていません。ログイン状態を確認してください。";
  if (kind === "validation") {
    return "MFAの前提条件またはパスキー確認を確認して再試行してください。";
  }
  return "MFA設定を変更できませんでした。時間をおいて再試行してください。";
}
