export const IDENTITY_USER_STATUSES = ["ACTIVE", "DISABLED", "LOCKED"] as const;

export type IdentityUserStatus = (typeof IDENTITY_USER_STATUSES)[number];

export type IdentityUser = {
  createdAt: string;
  deletedAt: string | null;
  email: string;
  id: string;
  lastLoginAt: string | null;
  status: IdentityUserStatus;
  updatedAt: string;
};

export type IdentityDirectoryFilters = {
  deleted: "all" | "deleted" | "not_deleted";
  email: string;
  status: "" | IdentityUserStatus;
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

export function isIdentityUserStatus(value: unknown): value is IdentityUserStatus {
  return IDENTITY_USER_STATUSES.includes(value as IdentityUserStatus);
}

export function isIdentityUser(value: unknown): value is IdentityUser {
  if (!isRecord(value)) return false;
  return (
    isString(value.id)
    && isString(value.email)
    && isIdentityUserStatus(value.status)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && isNullableString(value.lastLoginAt)
    && isNullableString(value.deletedAt)
  );
}

export function isIdentityUserList(value: unknown): value is IdentityUser[] {
  return Array.isArray(value) && value.every(isIdentityUser);
}

export function identityUserListPath(filters: IdentityDirectoryFilters): string {
  const parameters = new URLSearchParams({ limit: "100", offset: "0" });
  const email = filters.email.trim();
  if (email.length > 0) parameters.set("email", email);
  if (filters.status.length > 0) parameters.set("status", filters.status);
  if (filters.deleted === "deleted") parameters.set("deleted", "true");
  if (filters.deleted === "not_deleted") parameters.set("deleted", "false");
  return `/identity/users?${parameters.toString()}`;
}

export function allowedIdentityStatusTransitions(user: IdentityUser): readonly IdentityUserStatus[] {
  if (user.deletedAt !== null) return [];
  if (user.status === "ACTIVE") return ["DISABLED", "LOCKED"];
  return ["ACTIVE"];
}

export function replaceIdentityUser(users: IdentityUser[], updatedUser: IdentityUser): IdentityUser[] {
  return users.map((user) => user.id === updatedUser.id ? updatedUser : user);
}

export function identityStatusLabel(status: IdentityUserStatus): string {
  if (status === "ACTIVE") return "有効";
  if (status === "DISABLED") return "無効";
  return "ロック中";
}
