import type { ApiClient } from "@/lib/api-client";

export const passwordRecoveryRequestPath = "/auth/password/recovery/request";

export type PasswordRecoveryRequestAccepted = {
  status: "accepted";
};

export type PasswordRecoveryResetComplete = {
  status: "ok";
};

export function isPasswordRecoveryRequestAccepted(value: unknown): value is PasswordRecoveryRequestAccepted {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "status" && (value as { status?: unknown }).status === "accepted";
}

export function requestPasswordRecovery(
  api: ApiClient,
  payload: { email: string },
): Promise<PasswordRecoveryRequestAccepted> {
  return api.request<unknown>(passwordRecoveryRequestPath, {
    body: payload,
    credentials: "omit",
    csrf: "none",
    expectedStatus: 202,
  }).then((response) => {
    if (!isPasswordRecoveryRequestAccepted(response)) throw new Error("Unexpected password recovery request response.");
    return response;
  });
}

export function isPasswordRecoveryResetComplete(value: unknown): value is PasswordRecoveryResetComplete {
  return (
    typeof value === "object"
    && value !== null
    && Object.keys(value).length === 1
    && (value as { status?: unknown }).status === "ok"
  );
}

export function passwordRecoveryRequestPayload(email: string): { email: string } | null {
  const normalizedEmail = email.trim();
  return normalizedEmail.length > 0 ? { email: normalizedEmail } : null;
}
