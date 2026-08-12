const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PrismaIdentityAdministrationRepository,
} = require("../dist/modules/identity/infrastructure/prisma-identity-administration.repository.js");
const {
  IdentityAdministrationController,
} = require("../dist/modules/identity/presentation/identity-administration.controller.js");
const {
  IdentityAdministrationConflictError,
  IdentityAdministrationForbiddenError,
  IdentityAdministrationValidationError,
} = require("../dist/modules/identity/application/identity-administration.errors.js");
const {
  Permissions,
  ALL_PERMISSION_DEFINITIONS,
} = require("../dist/modules/authorization/permission.registry.js");
const {
  REQUIRED_PERMISSIONS_KEY,
} = require("../dist/modules/authorization/authorization.constants.js");

const user = (overrides = {}) => ({
  id: "user-1",
  email: "user@example.test",
  status: "ACTIVE",
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T00:00:00.000Z"),
  lastLoginAt: null,
  deletedAt: null,
  ...overrides,
});

function lifecycleRepository({ currentUser = user(), systemAdmin = false } = {}) {
  const events = [];
  const transaction = {
    async $queryRaw() {
      return [currentUser];
    },
    userRole: {
      async findFirst() {
        return systemAdmin ? { roleId: "system-admin" } : null;
      },
    },
    user: {
      async update({ data }) {
        events.push(["user", data]);
        return user({ ...currentUser, ...data, updatedAt: new Date("2026-08-12T00:01:00.000Z") });
      },
    },
    identityAuditLog: {
      async create({ data }) {
        events.push(["audit", data]);
      },
    },
  };
  return {
    events,
    repository: new PrismaIdentityAdministrationRepository({
      async $transaction(operation) {
        return operation(transaction);
      },
    }),
  };
}

test("identity directory selects only safe fields with deterministic pagination and normalized exact email", async () => {
  let args;
  const repository = new PrismaIdentityAdministrationRepository({
    user: {
      async findMany(input) {
        args = input;
        return [user()];
      },
    },
  });

  const result = await repository.listUsers({
    email: " USER@EXAMPLE.TEST ",
    status: "ACTIVE",
    deleted: false,
    limit: 10,
    offset: 5,
  });

  assert.deepEqual(result, [user()]);
  assert.equal(args.where.email, "user@example.test");
  assert.equal(args.where.deletedAt, null);
  assert.deepEqual(args.orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.equal(args.take, 10);
  assert.equal(args.skip, 5);
  assert.equal("passwordHash" in args.select, false);
  assert.equal("sessions" in args.select, false);
});

test("identity lifecycle permits only documented non-system status transitions and writes a focused audit", async () => {
  for (const [from, to] of [["ACTIVE", "DISABLED"], ["ACTIVE", "LOCKED"], ["DISABLED", "ACTIVE"], ["LOCKED", "ACTIVE"]]) {
    const { repository, events } = lifecycleRepository({ currentUser: user({ status: from }) });
    const updated = await repository.updateUserStatus("user-1", { actorUserId: "actor-1", status: to });
    assert.equal(updated.status, to);
    assert.deepEqual(events[0], ["user", { status: to }]);
    assert.equal(events[1][1].action, "UPDATE_USER_STATUS");
    assert.equal(events[1][1].actorUserId, "actor-1");
    assert.equal(events[1][1].targetUserId, "user-1");
    assert.deepEqual(events[1][1].beforeState, { status: from, deletedAt: null });
    assert.deepEqual(events[1][1].afterState, { status: to, deletedAt: null });
  }

  for (const [from, to] of [["ACTIVE", "ACTIVE"], ["DISABLED", "LOCKED"], ["LOCKED", "DISABLED"]]) {
    const { repository } = lifecycleRepository({ currentUser: user({ status: from }) });
    await assert.rejects(
      () => repository.updateUserStatus("user-1", { actorUserId: "actor-1", status: to }),
      IdentityAdministrationValidationError,
    );
  }
});

test("soft-deleted and SYSTEM_ADMIN users cannot be changed through identity administration", async () => {
  const deleted = lifecycleRepository({ currentUser: user({ deletedAt: new Date("2026-08-12T00:00:00.000Z") }) });
  await assert.rejects(
    () => deleted.repository.updateUserStatus("user-1", { actorUserId: "actor-1", status: "DISABLED" }),
    IdentityAdministrationValidationError,
  );
  await assert.rejects(
    () => deleted.repository.softDeleteUser("user-1", "actor-1"),
    IdentityAdministrationConflictError,
  );

  const systemAdmin = lifecycleRepository({ systemAdmin: true });
  await assert.rejects(
    () => systemAdmin.repository.updateUserStatus("user-1", { actorUserId: "actor-1", status: "DISABLED" }),
    IdentityAdministrationForbiddenError,
  );
  await assert.rejects(
    () => systemAdmin.repository.softDeleteUser("user-1", "actor-1"),
    IdentityAdministrationForbiddenError,
  );
  assert.deepEqual(systemAdmin.events, []);
});

test("soft delete records actor and before/after lifecycle state in the same transaction", async () => {
  const { repository, events } = lifecycleRepository();
  const result = await repository.softDeleteUser("user-1", "actor-from-session");
  assert.equal(result.deletedAt instanceof Date, true);
  assert.equal(events[0][0], "user");
  assert.equal(events[1][1].action, "SOFT_DELETE_USER");
  assert.equal(events[1][1].actorUserId, "actor-from-session");
  assert.equal(events[1][1].targetUserId, "user-1");
  assert.equal(events[1][1].beforeState.deletedAt, null);
  assert.equal(typeof events[1][1].afterState.deletedAt, "string");
});

test("identity permissions keep lifecycle management SYSTEM_ADMIN-only and controller uses session actor", async () => {
  assert.equal(ALL_PERMISSION_DEFINITIONS.find((item) => item.code === Permissions.IDENTITY_READ).customRoleAssignable, true);
  assert.equal(ALL_PERMISSION_DEFINITIONS.find((item) => item.code === Permissions.IDENTITY_MANAGE).customRoleAssignable, false);

  const calls = [];
  const controller = new IdentityAdministrationController({
    async updateUserStatus(id, input) {
      calls.push([id, input]);
      return user({ status: input.status });
    },
  });
  await controller.updateUserStatus({ authUser: { id: "actor-from-session" } }, "target-user", {
    status: "DISABLED",
    actorUserId: "spoofed-client-actor",
  });
  assert.deepEqual(calls, [["target-user", { actorUserId: "actor-from-session", status: "DISABLED" }]]);

  const assertions = [
    ["listUsers", Permissions.IDENTITY_READ],
    ["getUser", Permissions.IDENTITY_READ],
    ["updateUserStatus", Permissions.IDENTITY_MANAGE],
    ["softDeleteUser", Permissions.IDENTITY_MANAGE],
  ];
  for (const [methodName, permission] of assertions) {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, IdentityAdministrationController.prototype[methodName]),
      [permission],
      methodName,
    );
  }
});
