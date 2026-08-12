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
const { ForbiddenException, UnauthorizedException } = require("@nestjs/common");
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
        passwordHash,
      };
    },
    async createSession(input) {
      assert.equal(input.userId, "user-1");
      assert.ok(input.tokenHash.length > 0);
      assert.ok(input.csrfTokenHash.length > 0);
      return {
        id: "session-1",
        userId: "user-1",
        expiresAt: input.expiresAt,
        revokedAt: null,
        csrfTokenHash: input.csrfTokenHash,
        lastSeenAt: null,
      };
    },
    async markUserLogin(userId) {
      assert.equal(userId, "user-1");
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
});

test("login use case rejects invalid credentials", async () => {
  const repository = {
    async findUserByEmail() {
      return null;
    },
  };
  await assert.rejects(
    () => new LoginUseCase(repository).execute({ email: "missing@lotus-brain.local", password: "secret" }),
    AuthInvalidCredentialsError,
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
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    csrfTokenHash: hashSecret("csrf-token"),
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
