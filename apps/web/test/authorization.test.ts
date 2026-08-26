import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRole,
  customRoleCreatePayload,
  customRoleUpdatePayload,
  grantPermissionLocally,
  grantRoleLocally,
  isAuthorizationPermissionList,
  isAuthorizationRole,
  revokePermissionLocally,
  revokeRoleLocally,
  validateCustomRoleCreate,
} from "../lib/authorization.ts";

const customRole = {
  id: "role-kitchen",
  code: "KITCHEN_OPERATOR",
  name: "Kitchen operator",
  description: null,
  isSystem: false,
  status: "ACTIVE" as const,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

const systemRole = { ...customRole, id: "role-admin", code: "SYSTEM_ADMIN", isSystem: true };

const catalog = [
  { id: "permission-master-read", code: "master.read", description: "Read master data.", customRoleAssignable: true },
  { id: "permission-auth-manage", code: "authorization.manage", description: "Manage authorization.", customRoleAssignable: false },
];

test("authorization response guards accept complete role and typed-catalog response shapes only", () => {
  assert.equal(isAuthorizationRole(customRole), true);
  assert.equal(isAuthorizationRole({ ...customRole, isSystem: "false" }), false);
  assert.equal(isAuthorizationPermissionList(catalog), true);
  assert.equal(isAuthorizationPermissionList([{ ...catalog[0], customRoleAssignable: "true" }]), false);
});

test("custom role creation accepts only the API's uppercase code shape and never creates arbitrary permission input", () => {
  assert.ok(validateCustomRoleCreate({ code: "KITCHEN_OPERATOR", name: "Kitchen", description: "" }).code === undefined);
  assert.ok(validateCustomRoleCreate({ code: "kitchen.operator", name: "Kitchen", description: "" }).code !== undefined);
  assert.deepEqual(
    customRoleCreatePayload({ code: " KITCHEN_OPERATOR ", name: " Kitchen ", description: " " }),
    { code: "KITCHEN_OPERATOR", name: "Kitchen", description: undefined },
  );
});

test("custom role updates omit immutable code and system classification and send only changed fields", () => {
  assert.deepEqual(
    customRoleUpdatePayload({ name: "Senior kitchen", description: "Can post", status: "DISABLED" }, customRole),
    { name: "Senior kitchen", description: "Can post", status: "DISABLED" },
  );
  assert.deepEqual(
    customRoleUpdatePayload({ name: customRole.name, description: "", status: customRole.status }, customRole),
    {},
  );
});

test("successful 204 assignment mutations update only the already-known response state without a follow-up read", () => {
  const grantedPermissions = grantPermissionLocally([], catalog, "permission-master-read");
  assert.deepEqual(grantedPermissions.map((permission) => permission.id), ["permission-master-read"]);
  assert.deepEqual(revokePermissionLocally(grantedPermissions, "permission-master-read"), []);

  const grantedRoles = grantRoleLocally([systemRole], customRole);
  assert.deepEqual(grantedRoles.map((role) => role.code), ["KITCHEN_OPERATOR", "SYSTEM_ADMIN"]);
  assert.deepEqual(revokeRoleLocally(grantedRoles, customRole.id).map((role) => role.code), ["SYSTEM_ADMIN"]);
});

test("new custom roles are added from the successful response in stable code order", () => {
  assert.deepEqual(appendRole([customRole], { ...customRole, id: "role-baker", code: "BAKER" }).map((role) => role.code), ["BAKER", "KITCHEN_OPERATOR"]);
});
