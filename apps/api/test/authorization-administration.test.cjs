const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PrismaAuthorizationRepository,
} = require("../dist/modules/authorization/infrastructure/prisma-authorization.repository.js");
const {
  AuthorizationAdministrationController,
} = require("../dist/modules/authorization/presentation/authorization-administration.controller.js");
const {
  AuthorizationAdministrationForbiddenError,
  AuthorizationAdministrationValidationError,
} = require("../dist/modules/authorization/application/authorization-administration.errors.js");
const {
  Permissions,
  ALL_PERMISSION_DEFINITIONS,
} = require("../dist/modules/authorization/permission.registry.js");
const {
  REQUIRED_PERMISSIONS_KEY,
} = require("../dist/modules/authorization/authorization.constants.js");

const customRole = (overrides = {}) => ({
  id: "role-custom",
  code: "KITCHEN_OPERATOR",
  name: "Kitchen operator",
  description: null,
  isSystem: false,
  status: "ACTIVE",
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
  ...overrides,
});

test("custom role creation records the authenticated actor in the same transaction", async () => {
  const events = [];
  const role = customRole();
  const transaction = {
    role: {
      async create({ data }) {
        events.push(["role", data]);
        return role;
      },
    },
    authorizationAuditLog: {
      async create({ data }) {
        events.push(["audit", data]);
      },
    },
  };
  const repository = new PrismaAuthorizationRepository({
    async $transaction(operation) {
      return operation(transaction);
    },
  });

  const result = await repository.createCustomRole({
    actorUserId: "actor-from-session",
    code: "KITCHEN_OPERATOR",
    name: "Kitchen operator",
  });

  assert.equal(result.isSystem, false);
  assert.equal(events[0][1].isSystem, false);
  assert.equal(events[0][1].status, "ACTIVE");
  assert.equal(events[1][1].actorUserId, "actor-from-session");
  assert.equal(events[1][1].action, "CREATE_CUSTOM_ROLE");
  assert.equal(events[1][1].source, "AUTHORIZATION_API");
});

test("system roles and authorization.manage cannot be mutated through custom-role paths", async () => {
  const systemRepository = new PrismaAuthorizationRepository({
    async $transaction(operation) {
      return operation({
        role: {
          async findUnique() {
            return customRole({ id: "system-role", code: "SYSTEM_ADMIN", isSystem: true });
          },
        },
      });
    },
  });
  await assert.rejects(
    () => systemRepository.updateCustomRole("system-role", { actorUserId: "actor", name: "Nope" }),
    AuthorizationAdministrationForbiddenError,
  );

  const writes = [];
  const manageRepository = new PrismaAuthorizationRepository({
    async $transaction(operation) {
      return operation({
        role: { async findUnique() { return customRole(); } },
        permission: { async findUnique() { return { id: "manage", code: Permissions.AUTHORIZATION_MANAGE }; } },
        rolePermission: { async create(data) { writes.push(data); } },
        authorizationAuditLog: { async create(data) { writes.push(data); } },
      });
    },
  });
  await assert.rejects(
    () => manageRepository.grantRolePermission("actor", "role-custom", "manage"),
    AuthorizationAdministrationValidationError,
  );
  assert.deepEqual(writes, []);
});

test("disabled custom roles cannot be granted, while a disabled user's cleanup revoke remains possible", async () => {
  const repository = new PrismaAuthorizationRepository({
    async $transaction(operation) {
      return operation({
        role: { async findUnique() { return customRole({ status: "DISABLED" }); } },
      });
    },
  });
  await assert.rejects(
    () => repository.grantUserRole("actor", "user", "role-custom"),
    AuthorizationAdministrationValidationError,
  );
});

test("permission reads expose only known registry entries with delegation metadata", async () => {
  const repository = new PrismaAuthorizationRepository({
    permission: {
      async findMany() {
        return [
          { id: "read", code: Permissions.AUTHORIZATION_READ },
          { id: "manage", code: Permissions.AUTHORIZATION_MANAGE },
          { id: "unknown", code: "unknown.permission" },
        ];
      },
    },
  });
  const permissions = await repository.listPermissions();
  assert.deepEqual(permissions.map((item) => item.code), [
    Permissions.AUTHORIZATION_READ,
    Permissions.AUTHORIZATION_MANAGE,
  ]);
  assert.equal(permissions[0].customRoleAssignable, true);
  assert.equal(permissions[1].customRoleAssignable, false);
  assert.equal(ALL_PERMISSION_DEFINITIONS.find((item) => item.code === Permissions.AUTHORIZATION_MANAGE).customRoleAssignable, false);
});

test("effective permission reads query active role assignments for only the current user", async () => {
  const calls = [];
  const repository = new PrismaAuthorizationRepository({
    permission: {
      async findMany(input) {
        calls.push(input);
        return [{ code: Permissions.MASTER_READ }, { code: Permissions.PURCHASE_READ }];
      },
    },
  });

  const permissions = await repository.listEffectivePermissions("current-user");

  assert.deepEqual(permissions, [Permissions.MASTER_READ, Permissions.PURCHASE_READ]);
  assert.deepEqual(calls[0].where.rolePermissions, {
    some: {
      role: {
        status: "ACTIVE",
        userRoles: { some: { userId: "current-user" } },
      },
    },
  });
  assert.deepEqual(calls[0].orderBy, { code: "asc" });
});

test("administration routes use authorization permissions and actor identity comes only from the request", async () => {
  const calls = [];
  const controller = new AuthorizationAdministrationController({
    async createCustomRole(input) {
      calls.push(input);
      return customRole();
    },
  });
  const request = { authUser: { id: "actor-from-session" } };
  await controller.createRole(request, {
    code: "KITCHEN_OPERATOR",
    name: "Kitchen operator",
    description: "Posts production.",
    actorUserId: "spoofed-client-actor",
  });
  assert.equal(calls[0].actorUserId, "actor-from-session");
  assert.equal(calls[0].actorUserId, "actor-from-session");

  const assertions = [
    ["createRole", Permissions.AUTHORIZATION_MANAGE],
    ["listRoles", Permissions.AUTHORIZATION_READ],
    ["getRole", Permissions.AUTHORIZATION_READ],
    ["updateRole", Permissions.AUTHORIZATION_MANAGE],
    ["listPermissions", Permissions.AUTHORIZATION_READ],
    ["listRolePermissions", Permissions.AUTHORIZATION_READ],
    ["grantRolePermission", Permissions.AUTHORIZATION_MANAGE],
    ["revokeRolePermission", Permissions.AUTHORIZATION_MANAGE],
    ["listUserRoles", Permissions.AUTHORIZATION_READ],
    ["grantUserRole", Permissions.AUTHORIZATION_MANAGE],
    ["revokeUserRole", Permissions.AUTHORIZATION_MANAGE],
  ];
  for (const [methodName, permission] of assertions) {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AuthorizationAdministrationController.prototype[methodName]),
      [permission],
      methodName,
    );
  }
});
