import { SetMetadata } from "@nestjs/common";
import { REQUIRED_PERMISSIONS_KEY } from "../authorization.constants";
import { isKnownPermissionCode, type PermissionCode } from "../permission.registry";

export function RequirePermissions(...permissions: readonly PermissionCode[]) {
  if (permissions.length === 0 || permissions.some((permission) => !isKnownPermissionCode(permission))) {
    throw new Error("RequirePermissions requires one or more known permission codes.");
  }
  return SetMetadata(REQUIRED_PERMISSIONS_KEY, Object.freeze([...permissions]));
}
