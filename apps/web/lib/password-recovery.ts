export const passwordRecoveryRequestPath = "/auth/password/recovery/request";

export type PasswordRecoveryRequestAccepted = {
  status: "accepted";
};

export type PasswordRecoveryResetComplete = {
  status: "ok";
};

export function isPasswordRecoveryRequestAccepted(value: unknown): value is PasswordRecoveryRequestAccepted {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "accepted";
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
