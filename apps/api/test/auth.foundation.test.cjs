const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");

const {
  LoginUseCase,
  BootstrapUserUseCase,
} = require("../dist/modules/auth/application/auth.use-cases.js");
const { AuthInvalidCredentialsError, AuthForbiddenError } = require("../dist/modules/auth/auth.errors.js");
const { SessionAuthGuard } = require("../dist/modules/auth/guards/session-auth.guard.js");
const { CsrfGuard } = require("../dist/modules/auth/guards/csrf.guard.js");
const { AuthorizationGuard } = require("../dist/modules/authorization/guards/authorization.guard.js");
const { RequirePermissions } = require("../dist/modules/authorization/decorators/require-permissions.decorator.js");
const { Permissions, ALL_PERMISSION_CODES } = require("../dist/modules/authorization/permission.registry.js");
const { AUTHENTICATED_ONLY_KEY, REQUIRED_PERMISSIONS_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { ForbiddenException, ServiceUnavailableException, UnauthorizedException } = require("@nestjs/common");
const { MasterController } = require("../dist/modules/master/presentation/master.controller.js");
const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");
const { ProductionController } = require("../dist/modules/production/presentation/production.controller.js");
const { RecipeController } = require("../dist/modules/recipe/presentation/recipe.controller.js");
const { StocktakeController } = require("../dist/modules/stocktake/presentation/stocktake.controller.js");
const { AuthController } = require("../dist/modules/auth/presentation/auth.controller.js");
const {
  hashSecret,
  makeOpaqueToken,
  normalizeEmail,
  makeSessionCookieName,
} = require("../dist/modules/auth/auth.utils.js");

test("auth helpers normalize emails and produce opaque secrets", () => {
  assert.equal(normalizeEmail("  Admin@Lotus-Brain.Local "), "admin@lotus-brain.local");
  assert.equal(hashSecret("token"), hashSecret("token"));
  assert.notEqual(makeOpaqueToken(), makeOpaqueToken());
  assert.equal(makeSessionCookieName(true), "__Host-lotus_session");
  assert.equal(makeSessionCookieName(false), "lotus_session");
});

test("login use case returns safe user data and tokens", async () => {
  const passwordHash = await argon2.hash("change-me-now", { type: argon2.argon2id });
  const repository = {
    async findUserByEmail() {
      return {
        id: "user-1",
        email: "admin@lotus-brain.local",
        displayName: "Admin",
        status: "ACTIVE",
        lastLoginAt: null,
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
        deletedAt: null,
        credentialVersion: 1,
        passwordHash,
      };
    },
    async createPendingSession(input) {
      assert.equal(input.userId, "user-1");
      assert.equal(input.credentialVersion, 1);
      assert.ok(input.tokenHash.length > 0);
      assert.ok(input.csrfTokenHash.length > 0);
      return {
        id: "session-1",
        userId: "user-1",
        credentialVersion: 1,
        expiresAt: input.expiresAt,
        revokedAt: null,
        csrfTokenHash: input.csrfTokenHash,
        lastSeenAt: null,
      };
    },
  };
  const result = await new LoginUseCase(repository).execute({
    email: "admin@lotus-brain.local",
    password: "change-me-now",
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
  });
  assert.equal(result.user.email, "admin@lotus-brain.local");
  assert.equal(result.user.displayName, "Admin");
  assert.ok(result.sessionToken.length > 30);
  assert.ok(result.csrfToken.length > 30);
  assert.equal(result.user.passwordHash, undefined);
  assert.equal(result.user.deletedAt, undefined);
});

test("login use case rejects invalid credentials without disclosing the cause", async () => {
  const repository = {
    async findUserByEmail() {
      return null;
    },
  };
  await assert.rejects(
    () => new LoginUseCase(repository).execute({ email: "missing@lotus-brain.local", password: "secret" }),
    (error) => error instanceof AuthInvalidCredentialsError && error.message === "Invalid email or password.",
  );
});

for (const status of ["DISABLED", "LOCKED"]) {
  test(`login rejects a ${status} user with the generic invalid-credentials response`, async () => {
    const passwordHash = await argon2.hash("change-me-now", { type: argon2.argon2id });
    const repository = {
      async findUserByEmail() {
        return {
          id: "user-1",
          email: "user@lotus-brain.local",
          displayName: "User",
          status,
          deletedAt: null,
          lastLoginAt: null,
          createdAt: new Date("2026-08-11T00:00:00.000Z"),
          updatedAt: new Date("2026-08-11T00:00:00.000Z"),
          credentialVersion: 1,
          passwordHash,
        };
      },
      async createPendingSession() {
        throw new Error("session must not be created");
      },
    };
    await assert.rejects(
      () => new LoginUseCase(repository).execute({ email: "user@lotus-brain.local", password: "change-me-now" }),
      (error) => error instanceof AuthInvalidCredentialsError && error.message === "Invalid email or password.",
    );
  });
}

test("login rejects a soft-deleted user before every session side effect", async () => {
  const passwordHash = await argon2.hash("change-me-now", { type: argon2.argon2id });
  let sessionsCreated = 0;
  const repository = {
    async findUserByEmail() {
      return {
        id: "soft-deleted-user",
        email: "deleted@lotus-brain.local",
        displayName: "Deleted user",
        status: "ACTIVE",
        deletedAt: new Date("2026-08-12T00:00:00.000Z"),
        lastLoginAt: new Date("2026-08-11T00:00:00.000Z"),
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
        credentialVersion: 1,
        passwordHash,
      };
    },
    async createPendingSession() {
      sessionsCreated += 1;
    },
  };

  await assert.rejects(
    () => new LoginUseCase(repository).execute({ email: "deleted@lotus-brain.local", password: "change-me-now" }),
    (error) => error instanceof AuthInvalidCredentialsError && error.message === "Invalid email or password.",
  );
  assert.equal(sessionsCreated, 0);
});

test("login rejects a wrong password with the generic invalid-credentials response", async () => {
  const passwordHash = await argon2.hash("correct-password", { type: argon2.argon2id });
  const repository = {
    async findUserByEmail() {
      return {
        id: "user-1",
        email: "user@lotus-brain.local",
        displayName: "User",
        status: "ACTIVE",
        deletedAt: null,
        lastLoginAt: null,
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        updatedAt: new Date("2026-08-11T00:00:00.000Z"),
        credentialVersion: 1,
        passwordHash,
      };
    },
  };
  await assert.rejects(
    () => new LoginUseCase(repository).execute({ email: "user@lotus-brain.local", password: "wrong-password" }),
    (error) => error instanceof AuthInvalidCredentialsError && error.message === "Invalid email or password.",
  );
});

test("bootstrap use case refuses second user", async () => {
  const repository = {
    async getUserCount() {
      return 1;
    },
  };
  await assert.rejects(
    () => new BootstrapUserUseCase(repository).execute({ email: "a@b.com", displayName: "Admin", password: "change-me-now" }),
    AuthForbiddenError,
  );
});

function makeAuthenticatedUser(overrides = {}) {
  return {
    id: "user-1",
    email: "admin@lotus-brain.local",
    displayName: "Admin",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    deletedAt: null,
    credentialVersion: 1,
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    activatedAt: new Date(),
    revokedAt: null,
    csrfTokenHash: hashSecret("csrf-token"),
    credentialVersion: 1,
    lastSeenAt: null,
    user: makeAuthenticatedUser(),
    ...overrides,
  };
}

function makeHttpContext(request) {
  return {
    getClass() {
      return class TestController {};
    },
    getHandler() {
      return function testHandler() {};
    },
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
      };
    },
  };
}

function makeSessionGuard(session) {
  const repository = {
    async findSessionByTokenHash() {
      return session;
    },
    async touchSession() {},
  };
  const reflector = {
    getAllAndOverride() {
      return false;
    },
  };
  const configService = {
    get() {
      return "development";
    },
  };
  return new SessionAuthGuard(reflector, repository, configService);
}

function makeSessionRequest(overrides = {}) {
  return {
    method: "GET",
    url: "/api/v1/products",
    headers: {},
    cookies: { lotus_session: "raw-session-token" },
    ...overrides,
  };
}

test("session guard accepts an active non-deleted user", async () => {
  const request = makeSessionRequest();
  const guard = makeSessionGuard(makeSession());

  assert.equal(await guard.canActivate(makeHttpContext(request)), true);
  assert.equal(request.authUser.status, "ACTIVE");
  assert.equal(request.authUser.deletedAt, undefined);
  assert.equal(request.authUser.passwordHash, undefined);
  assert.equal(request.authUser.tokenHash, undefined);
  assert.equal(request.authUser.csrfTokenHash, undefined);
});

for (const status of ["DISABLED", "LOCKED"]) {
  test(`session guard rejects an existing session for a ${status} user`, async () => {
    const session = makeSession({ user: makeAuthenticatedUser({ status }) });
    await assert.rejects(
      () => makeSessionGuard(session).canActivate(makeHttpContext(makeSessionRequest())),
      UnauthorizedException,
    );
  });
}

test("session guard rejects an existing session for a soft-deleted user", async () => {
  const session = makeSession({
    user: makeAuthenticatedUser({ deletedAt: new Date("2026-08-12T00:00:00.000Z") }),
  });
  await assert.rejects(
    () => makeSessionGuard(session).canActivate(makeHttpContext(makeSessionRequest())),
    UnauthorizedException,
  );
});

test("session guard rejects an existing session with a stale credential version", async () => {
  const session = makeSession({
    credentialVersion: 1,
    user: makeAuthenticatedUser({ credentialVersion: 2 }),
  });
  await assert.rejects(
    () => makeSessionGuard(session).canActivate(makeHttpContext(makeSessionRequest())),
    UnauthorizedException,
  );
});

test("session guard rejects revoked, expired, missing-user, or missing sessions", async (t) => {
  const cases = [
    ["revoked", makeSession({ revokedAt: new Date() })],
    ["expired", makeSession({ expiresAt: new Date(Date.now() - 1) })],
    ["missing user", makeSession({ user: null })],
    ["missing session", null],
  ];

  for (const [name, session] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        () => makeSessionGuard(session).canActivate(makeHttpContext(makeSessionRequest())),
        UnauthorizedException,
      );
    });
  }
});

function makeCsrfGuard() {
  return new CsrfGuard({
    getAllAndOverride() {
      return false;
    },
  });
}

test("csrf guard returns 403 for missing or invalid tokens", () => {
  const guard = makeCsrfGuard();
  const session = makeSession();

  assert.throws(
    () => guard.canActivate(makeHttpContext(makeSessionRequest({ method: "POST", authSession: session }))),
    ForbiddenException,
  );
  assert.throws(
    () => guard.canActivate(makeHttpContext(makeSessionRequest({
      method: "POST",
      authSession: session,
      headers: { "x-csrf-token": "invalid" },
    }))),
    ForbiddenException,
  );
});

test("csrf guard accepts a valid token and keeps unauthenticated state changes at 401", () => {
  const guard = makeCsrfGuard();
  const session = makeSession();

  assert.equal(guard.canActivate(makeHttpContext(makeSessionRequest({
    method: "POST",
    authSession: session,
    headers: { "x-csrf-token": "csrf-token" },
  }))), true);
  assert.throws(
    () => guard.canActivate(makeHttpContext(makeSessionRequest({ method: "POST" }))),
    UnauthorizedException,
  );
});

function makeAuthorizationGuard({ isPublic = false, isAuthenticatedOnly = false, permissions, evaluate } = {}) {
  const reflector = {
    getAllAndOverride(key) {
      if (key === "auth:public") return isPublic;
      if (key === AUTHENTICATED_ONLY_KEY) return isAuthenticatedOnly;
      if (key === REQUIRED_PERMISSIONS_KEY) return permissions;
      return undefined;
    },
  };
  const service = {
    async hasAllPermissions(userId, requiredPermissions) {
      assert.equal(userId, "user-1");
      assert.deepEqual(requiredPermissions, permissions);
      return evaluate === undefined ? true : evaluate();
    },
  };
  return new AuthorizationGuard(reflector, service);
}

test("permission registry is fixed and RequirePermissions rejects unknown codes", () => {
  assert.equal(Object.isFrozen(Permissions), true);
  assert.deepEqual(ALL_PERMISSION_CODES, [
    "authorization.read", "authorization.manage",
    "identity.read", "identity.manage",
    "master.read", "master.write", "purchase.read", "purchase.write", "purchase.confirm", "purchase.post",
    "production.read", "production.write", "production.confirm", "production.post",
    "stocktake.read", "stocktake.write", "stocktake.confirm", "stocktake.post",
  ]);
  assert.throws(() => RequirePermissions("purchase.typo"), /known permission/i);
  assert.throws(() => RequirePermissions(), /one or more/i);
});

test("authorization guard is public/authenticated-only aware and denies unclassified endpoints", async () => {
  const anonymousRequest = { url: "/api/v1/health" };
  assert.equal(
    await makeAuthorizationGuard({ isPublic: true }).canActivate(makeHttpContext(anonymousRequest)),
    true,
  );
  await assert.rejects(
    () => makeAuthorizationGuard().canActivate(makeHttpContext(anonymousRequest)),
    UnauthorizedException,
  );

  const authenticatedRequest = { url: "/api/v1/unclassified", authUser: makeAuthenticatedUser() };
  assert.equal(
    await makeAuthorizationGuard({ isAuthenticatedOnly: true }).canActivate(makeHttpContext(authenticatedRequest)),
    true,
  );
  await assert.rejects(
    () => makeAuthorizationGuard().canActivate(makeHttpContext(authenticatedRequest)),
    ForbiddenException,
  );
});

test("authorization guard evaluates current DB permissions and fails closed", async () => {
  const request = { url: "/api/v1/purchases/purchase-1/post", authUser: makeAuthenticatedUser() };
  const required = [Permissions.PURCHASE_POST];
  assert.equal(
    await makeAuthorizationGuard({ permissions: required }).canActivate(makeHttpContext(request)),
    true,
  );
  await assert.rejects(
    () => makeAuthorizationGuard({ permissions: required, evaluate: () => false }).canActivate(makeHttpContext(request)),
    ForbiddenException,
  );
  await assert.rejects(
    () => makeAuthorizationGuard({
      permissions: required,
      evaluate: () => { throw new Error("database offline"); },
    }).canActivate(makeHttpContext(request)),
    ServiceUnavailableException,
  );
});

test("every existing business endpoint has the exact required permission", () => {
  const assertions = [
    [MasterController, "createProduct", Permissions.MASTER_WRITE],
    [MasterController, "listProducts", Permissions.MASTER_READ],
    [MasterController, "getProduct", Permissions.MASTER_READ],
    [MasterController, "updateProduct", Permissions.MASTER_WRITE],
    [MasterController, "createProductUnitConversion", Permissions.MASTER_WRITE],
    [MasterController, "listProductUnitConversions", Permissions.MASTER_READ],
    [MasterController, "getProductUnitConversion", Permissions.MASTER_READ],
    [MasterController, "createUnit", Permissions.MASTER_WRITE],
    [MasterController, "listUnits", Permissions.MASTER_READ],
    [MasterController, "getUnit", Permissions.MASTER_READ],
    [MasterController, "updateUnit", Permissions.MASTER_WRITE],
    [MasterController, "createSupplier", Permissions.MASTER_WRITE],
    [MasterController, "listSuppliers", Permissions.MASTER_READ],
    [MasterController, "getSupplier", Permissions.MASTER_READ],
    [MasterController, "updateSupplier", Permissions.MASTER_WRITE],
    [PurchaseController, "createPurchase", Permissions.PURCHASE_WRITE],
    [PurchaseController, "getPurchase", Permissions.PURCHASE_READ],
    [PurchaseController, "updatePurchase", Permissions.PURCHASE_WRITE],
    [PurchaseController, "confirmPurchase", Permissions.PURCHASE_CONFIRM],
    [PurchaseController, "postPurchase", Permissions.PURCHASE_POST],
    [ProductionController, "createProduction", Permissions.PRODUCTION_WRITE],
    [ProductionController, "getProduction", Permissions.PRODUCTION_READ],
    [ProductionController, "updateProduction", Permissions.PRODUCTION_WRITE],
    [ProductionController, "confirmProduction", Permissions.PRODUCTION_CONFIRM],
    [ProductionController, "postProduction", Permissions.PRODUCTION_POST],
    [RecipeController, "createRecipe", Permissions.MASTER_WRITE],
    [RecipeController, "listRecipes", Permissions.MASTER_READ],
    [RecipeController, "getRecipe", Permissions.MASTER_READ],
    [RecipeController, "updateRecipe", Permissions.MASTER_WRITE],
    [RecipeController, "activateRecipe", Permissions.MASTER_WRITE],
    [RecipeController, "archiveRecipe", Permissions.MASTER_WRITE],
    [RecipeController, "createRevision", Permissions.MASTER_WRITE],
    [StocktakeController, "create", Permissions.STOCKTAKE_WRITE],
    [StocktakeController, "get", Permissions.STOCKTAKE_READ],
    [StocktakeController, "update", Permissions.STOCKTAKE_WRITE],
    [StocktakeController, "confirm", Permissions.STOCKTAKE_CONFIRM],
    [StocktakeController, "post", Permissions.STOCKTAKE_POST],
  ];
  for (const [controller, methodName, expectedPermission] of assertions) {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.prototype[methodName]),
      [expectedPermission],
      `${controller.name}.${methodName}`,
    );
  }

  for (const methodName of ["me", "permissions", "csrf", "logout"]) {
    assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, AuthController.prototype[methodName]), true);
  }
});

test("current permission bootstrap derives permissions only from the authenticated session user", async () => {
  const calls = [];
  const controller = new AuthController(
    { get: () => "development" },
    {},
    {},
    {},
    { async listEffectivePermissions(userId) { calls.push(userId); return [Permissions.MASTER_READ]; } },
    {},
    {},
  );
  const headers = [];
  const response = { setHeader(name, value) { headers.push([name, value]); } };

  const result = await controller.permissions({ authUser: { id: "user-from-session" } }, response);

  assert.deepEqual(result, { permissions: [Permissions.MASTER_READ] });
  assert.deepEqual(calls, ["user-from-session"]);
  assert.deepEqual(headers, [["Cache-Control", "no-store"]]);
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, AuthController.prototype.permissions), true);
});

test("current user bootstrap derives the user only from the authenticated session and is never cacheable", async () => {
  const calls = [];
  const user = {
    id: "user-from-session",
    email: "user@example.test",
    displayName: "Current User",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
    updatedAt: new Date("2026-08-31T00:00:00.000Z"),
  };
  const controller = new AuthController(
    { get: () => "development" },
    {},
    {},
    { async execute(userId) { calls.push(userId); return user; } },
    {},
    {},
    {},
  );
  const headers = [];
  const response = { setHeader(name, value) { headers.push([name, value]); } };

  const result = await controller.me({ authUser: { id: "user-from-session" } }, response);

  assert.deepEqual(result, { user });
  assert.deepEqual(calls, ["user-from-session"]);
  assert.deepEqual(headers, [["Cache-Control", "no-store"]]);
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, AuthController.prototype.me), true);
});
