export const emailVerificationRequestPath = "/auth/email/verification/request";

export type EmailVerificationConfirmed = {
  status: "verified";
};

export function isEmailVerificationRequestAccepted(payload: unknown): payload is { status: "accepted" } {
  return typeof payload === "object" && payload !== null && (payload as { status?: unknown }).status === "accepted";
}

export function isEmailVerificationConfirmed(payload: unknown): payload is EmailVerificationConfirmed {
  return (
    typeof payload === "object"
    && payload !== null
    && Object.keys(payload).length === 1
    && (payload as { status?: unknown }).status === "verified"
  );
}
