import type { PermissionCode } from "../permission.registry";

export const AUTHORIZATION_REPOSITORY = Symbol("AUTHORIZATION_REPOSITORY");

export type GrantSystemAdminResult =
  | { kind: "GRANTED"; email: string }
  | { kind: "ALREADY_ASSIGNED"; email: string }
  | { kind: "USER_NOT_FOUND"; email: string }
  | { kind: "USER_INELIGIBLE"; email: string };

export interface AuthorizationRepository {
  hasAllPermissions(userId: string, permissions: readonly PermissionCode[]): Promise<boolean>;
  listEffectivePermissions(userId: string): Promise<PermissionCode[]>;
  grantSystemAdminByEmail(email: string): Promise<GrantSystemAdminResult>;
}
