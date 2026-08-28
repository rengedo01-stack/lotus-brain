export type PasskeyMfaStatus = {
  activePasskeyCount: number;
  enabled: boolean;
  recoveryEmailVerified: boolean;
};

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
  if (typeof value !== "object" || value === null) return false;
  const status = value as Partial<PasskeyMfaStatus>;
  return (
    typeof status.enabled === "boolean" &&
    typeof status.activePasskeyCount === "number" &&
    Number.isInteger(status.activePasskeyCount) &&
    status.activePasskeyCount >= 0 &&
    typeof status.recoveryEmailVerified === "boolean"
  );
}

export function isPasskeyAuthenticationOptions(value: unknown): value is { challenge: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { challenge?: unknown }).challenge === "string" &&
    (value as { challenge: string }).challenge.length > 0
  );
}

export function isPasskeyMfaMutationResponse(value: unknown): value is { status: "ok" } {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "ok";
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
