export const passwordChangePath = "/auth/password/change";

export type PasswordChangePayload = {
  currentPassword: string;
  newPassword: string;
};

export function passwordChangePayload(
  currentPassword: unknown,
  newPassword: unknown,
  confirmation: unknown,
): PasswordChangePayload | null {
  if (
    typeof currentPassword !== "string"
    || currentPassword.length === 0
    || typeof newPassword !== "string"
    || newPassword.length === 0
    || newPassword !== confirmation
  ) {
    return null;
  }

  return { currentPassword, newPassword };
}

export function isPasswordChangeAccepted(payload: unknown): payload is { status: "ok" } {
  return typeof payload === "object" && payload !== null && (payload as { status?: unknown }).status === "ok";
}
