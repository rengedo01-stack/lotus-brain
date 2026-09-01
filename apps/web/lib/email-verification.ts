import type { ApiClient } from "@/lib/api-client";

export const emailVerificationRequestPath = "/auth/email/verification/request";

export type EmailVerificationConfirmed = {
  status: "verified";
};

export function isEmailVerificationRequestAccepted(payload: unknown): payload is { status: "accepted" } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "status" && (payload as { status?: unknown }).status === "accepted";
}

export function requestEmailVerification(api: ApiClient): Promise<{ status: "accepted" }> {
  return api.request<unknown>(emailVerificationRequestPath, {
    method: "POST",
    expectedStatus: 202,
  }).then((response) => {
    if (!isEmailVerificationRequestAccepted(response)) throw new Error("Unexpected email verification request response.");
    return response;
  });
}

export function isEmailVerificationConfirmed(payload: unknown): payload is EmailVerificationConfirmed {
  return (
    typeof payload === "object"
    && payload !== null
    && Object.keys(payload).length === 1
    && (payload as { status?: unknown }).status === "verified"
  );
}
