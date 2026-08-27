export const emailVerificationRequestPath = "/auth/email/verification/request";

export function isEmailVerificationRequestAccepted(payload: unknown): payload is { status: "accepted" } {
  return typeof payload === "object" && payload !== null && (payload as { status?: unknown }).status === "accepted";
}
