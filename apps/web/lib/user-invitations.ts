export const USER_INVITATION_STATUSES = ["PENDING", "ACCEPTED", "CANCELLED"] as const;

export type UserInvitationStatus = (typeof USER_INVITATION_STATUSES)[number];

export type UserInvitation = {
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  email: string;
  id: string;
  status: UserInvitationStatus;
};

export type UserInvitationFilters = {
  status: "" | UserInvitationStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isUserInvitationStatus(value: unknown): value is UserInvitationStatus {
  return USER_INVITATION_STATUSES.includes(value as UserInvitationStatus);
}

export function isUserInvitation(value: unknown): value is UserInvitation {
  if (!isRecord(value)) return false;
  return (
    isString(value.id)
    && isString(value.email)
    && isUserInvitationStatus(value.status)
    && isString(value.createdAt)
    && isNullableString(value.acceptedAt)
    && isNullableString(value.cancelledAt)
  );
}

export function isUserInvitationList(value: unknown): value is UserInvitation[] {
  return Array.isArray(value) && value.every(isUserInvitation);
}

export function isUserInvitationResendAccepted(value: unknown): value is { status: "accepted" } {
  return isRecord(value) && value.status === "accepted";
}

export function userInvitationListPath(filters: UserInvitationFilters): string {
  const parameters = new URLSearchParams({ limit: "100", offset: "0" });
  if (filters.status.length > 0) parameters.set("status", filters.status);
  return `/identity/invitations?${parameters.toString()}`;
}

function compareInvitations(left: UserInvitation, right: UserInvitation): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
}

export function insertUserInvitation(invitations: UserInvitation[], invitation: UserInvitation): UserInvitation[] {
  return [...invitations.filter((entry) => entry.id !== invitation.id), invitation].sort(compareInvitations);
}

export function replaceUserInvitation(invitations: UserInvitation[], invitation: UserInvitation): UserInvitation[] {
  return invitations.map((entry) => entry.id === invitation.id ? invitation : entry);
}

export function userInvitationStatusLabel(status: UserInvitationStatus): string {
  if (status === "PENDING") return "送信待ち";
  if (status === "ACCEPTED") return "受諾済み";
  return "取消済み";
}
