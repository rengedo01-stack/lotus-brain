export const passwordRecoveryRequestPath = "/auth/password/recovery/request";

export type PasswordRecoveryRequestAccepted = {
  status: "accepted";
};

export function isPasswordRecoveryRequestAccepted(value: unknown): value is PasswordRecoveryRequestAccepted {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "accepted";
}

export function passwordRecoveryRequestPayload(email: string): { email: string } | null {
  const normalizedEmail = email.trim();
  return normalizedEmail.length > 0 ? { email: normalizedEmail } : null;
}
