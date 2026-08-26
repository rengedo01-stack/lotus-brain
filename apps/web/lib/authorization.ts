export const ROLE_STATUSES = ["ACTIVE", "DISABLED"] as const;

export type RoleStatus = (typeof ROLE_STATUSES)[number];

export type AuthorizationRole = {
  code: string;
  createdAt: string;
  description: string | null;
  id: string;
  isSystem: boolean;
  name: string;
  status: RoleStatus;
  updatedAt: string;
};

export type AuthorizationPermission = {
  code: string;
  customRoleAssignable: boolean;
  description: string;
  id: string;
};

export type IdentityUser = {
  createdAt: string;
  deletedAt: string | null;
  email: string;
  id: string;
  lastLoginAt: string | null;
  status: string;
  updatedAt: string;
};

export type CustomRoleFormValues = {
  code: string;
  description: string;
  name: string;
};

export type CustomRoleUpdateValues = Pick<AuthorizationRole, "name" | "status"> & {
  description: string;
};

export type AuthorizationFieldErrors = Record<string, string>;

const CUSTOM_ROLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

export function isRoleStatus(value: unknown): value is RoleStatus {
  return ROLE_STATUSES.includes(value as RoleStatus);
}

export function isAuthorizationRole(value: unknown): value is AuthorizationRole {
  if (!isRecord(value)) return false;
  return (
    isString(value.id)
    && isString(value.code)
    && isString(value.name)
    && isNullableString(value.description)
    && typeof value.isSystem === "boolean"
    && isRoleStatus(value.status)
    && isString(value.createdAt)
    && isString(value.updatedAt)
  );
}

export function isAuthorizationRoleList(value: unknown): value is AuthorizationRole[] {
  return Array.isArray(value) && value.every(isAuthorizationRole);
}

export function isAuthorizationPermission(value: unknown): value is AuthorizationPermission {
  if (!isRecord(value)) return false;
  return (
    isString(value.id)
    && isString(value.code)
    && isString(value.description)
    && typeof value.customRoleAssignable === "boolean"
  );
}

export function isAuthorizationPermissionList(value: unknown): value is AuthorizationPermission[] {
  return Array.isArray(value) && value.every(isAuthorizationPermission);
}

export function isIdentityUser(value: unknown): value is IdentityUser {
  if (!isRecord(value)) return false;
  return (
    isString(value.id)
    && isString(value.email)
    && isString(value.status)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && isNullableString(value.lastLoginAt)
    && isNullableString(value.deletedAt)
  );
}

export function isIdentityUserList(value: unknown): value is IdentityUser[] {
  return Array.isArray(value) && value.every(isIdentityUser);
}

export function initialCustomRoleFormValues(): CustomRoleFormValues {
  return { code: "", name: "", description: "" };
}

export function customRoleUpdateValues(role: AuthorizationRole): CustomRoleUpdateValues {
  return { name: role.name, description: role.description ?? "", status: role.status };
}

export function validateCustomRoleCreate(values: CustomRoleFormValues): AuthorizationFieldErrors {
  const errors: AuthorizationFieldErrors = {};
  if (!CUSTOM_ROLE_CODE.test(values.code.trim())) {
    errors.code = "ロールコードは先頭を英大文字とし、英大文字・数字・アンダースコアのみで64文字以内にしてください。";
  }
  if (values.name.trim().length === 0) errors.name = "ロール名を入力してください。";
  if (values.name.trim().length > 200) errors.name = "ロール名は200文字以内にしてください。";
  if (values.description.trim().length > 1000) errors.description = "説明は1000文字以内にしてください。";
  return errors;
}

export function customRoleCreatePayload(values: CustomRoleFormValues) {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim() || undefined,
  };
}

export function validateCustomRoleUpdate(values: CustomRoleUpdateValues): AuthorizationFieldErrors {
  const errors: AuthorizationFieldErrors = {};
  if (values.name.trim().length === 0) errors.name = "ロール名を入力してください。";
  if (values.name.trim().length > 200) errors.name = "ロール名は200文字以内にしてください。";
  if (values.description.trim().length > 1000) errors.description = "説明は1000文字以内にしてください。";
  return errors;
}

// Only changed, API-mutable fields are sent. Code and system classification are never client-editable.
export function customRoleUpdatePayload(values: CustomRoleUpdateValues, current: AuthorizationRole) {
  const payload: { description?: string | null; name?: string; status?: RoleStatus } = {};
  const name = values.name.trim();
  const description = values.description.trim() || null;
  if (name !== current.name) payload.name = name;
  if (description !== current.description) payload.description = description;
  if (values.status !== current.status) payload.status = values.status;
  return payload;
}

export function replaceRole(roles: AuthorizationRole[], role: AuthorizationRole): AuthorizationRole[] {
  return roles.map((candidate) => candidate.id === role.id ? role : candidate);
}

export function appendRole(roles: AuthorizationRole[], role: AuthorizationRole): AuthorizationRole[] {
  return [...roles, role].sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
}

// 204 mutation responses are intentionally applied from the successful request input, without a follow-up GET.
export function grantPermissionLocally(
  assigned: AuthorizationPermission[],
  catalog: AuthorizationPermission[],
  permissionId: string,
): AuthorizationPermission[] {
  const permission = catalog.find((candidate) => candidate.id === permissionId);
  if (permission === undefined || assigned.some((candidate) => candidate.id === permissionId)) return assigned;
  return [...assigned, permission].sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
}

export function revokePermissionLocally(assigned: AuthorizationPermission[], permissionId: string): AuthorizationPermission[] {
  return assigned.filter((candidate) => candidate.id !== permissionId);
}

export function grantRoleLocally(assigned: AuthorizationRole[], role: AuthorizationRole): AuthorizationRole[] {
  if (assigned.some((candidate) => candidate.id === role.id)) return assigned;
  return [...assigned, role].sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
}

export function revokeRoleLocally(assigned: AuthorizationRole[], roleId: string): AuthorizationRole[] {
  return assigned.filter((candidate) => candidate.id !== roleId);
}

export function roleStatusLabel(status: RoleStatus): string {
  return status === "ACTIVE" ? "有効" : "無効";
}
