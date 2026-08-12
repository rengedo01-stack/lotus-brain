import type { RoleStatus } from "../../../generated/prisma/client";
import type { PermissionCode } from "../permission.registry";

export const AUTHORIZATION_ADMINISTRATION_REPOSITORY = Symbol("AUTHORIZATION_ADMINISTRATION_REPOSITORY");

export type AuthorizationRoleView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: RoleStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthorizationPermissionView = {
  id: string;
  code: PermissionCode;
  description: string;
  customRoleAssignable: boolean;
};

export type CreateCustomRoleInput = {
  actorUserId: string;
  code: string;
  name: string;
  description?: string | null;
};

export type UpdateCustomRoleInput = {
  actorUserId: string;
  name?: string;
  description?: string | null;
  status?: RoleStatus;
};

export interface AuthorizationAdministrationRepository {
  createCustomRole(input: CreateCustomRoleInput): Promise<AuthorizationRoleView>;
  listRoles(): Promise<AuthorizationRoleView[]>;
  getRole(roleId: string): Promise<AuthorizationRoleView>;
  updateCustomRole(roleId: string, input: UpdateCustomRoleInput): Promise<AuthorizationRoleView>;
  listPermissions(): Promise<AuthorizationPermissionView[]>;
  listRolePermissions(roleId: string): Promise<AuthorizationPermissionView[]>;
  grantRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void>;
  revokeRolePermission(actorUserId: string, roleId: string, permissionId: string): Promise<void>;
  listUserRoles(userId: string): Promise<AuthorizationRoleView[]>;
  grantUserRole(actorUserId: string, userId: string, roleId: string): Promise<void>;
  revokeUserRole(actorUserId: string, userId: string, roleId: string): Promise<void>;
}
