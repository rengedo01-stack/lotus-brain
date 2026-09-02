const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const argon2 = require("argon2");
require("reflect-metadata");

const {
  ActivateSessionUseCase,
  LoginUseCase,
} = require("../dist/modules/auth/application/auth.use-cases.js");
const {
  AuthSessionActivationCsrfError,
  AuthSessionActivationUnauthorizedError,
} = require("../dist/modules/auth/auth.errors.js");
const { PendingSessionActivationGuard } = require("../dist/modules/auth/guards/pending-session-activation.guard.js");
const { SessionAuthGuard } = require("../dist/modules/auth/guards/session-auth.guard.js");
const { AuthorizationGuard } = require("../dist/modules/authorization/guards/authorization.guard.js");
const { CsrfGuard } = require("../dist/modules/auth/guards/csrf.guard.js");
const { AuthController } = require("../dist/modules/auth/presentation/auth.controller.js");
const {
  AUTH_PENDING_SESSION_ACTIVATION_KEY,
  AUTH_PUBLIC_KEY,
} = require("../dist/modules/auth/auth.constants.js");
const { hashSecret } = require("../dist/modules/auth/auth.utils.js");
const {
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} = require("@nestjs/common");

const PASSWORD = "pending session password is sufficiently long";

function user(overrides = {}) {
  return {
    id: "user-1",
    email: "pending@example.test",
    displayName: "Pending User",
    status: "ACTIVE",
    deletedAt: null,
    credentialVersion: 3,
    authenticationPolicyVersion: 5,
    passkeyMfaEnabledAt: null,
    lastLoginAt: new Date("2026-08-30T00:00:00.000Z"),
    createdAt: new Date("2026-08-11T00:00:00.000Z"),
    updatedAt: new Date("2026-08-11T00:00:00.000Z"),
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    tokenHash: hashSecret("raw-session-token"),
    csrfTokenHash: hashSecret("csrf-proof"),
    credentialVersion: 3,
    authenticationPolicyVersion: 5,
    expiresAt: new Date(Date.now() + 60_000),
    activatedAt: null,
    revokedAt: null,
    lastSeenAt: null,
    user: user(),
    ...overrides,
  };
}

function config(nodeEnvironment = "development") {
  return {
    get(key) {
      return {
        NODE_ENV: nodeEnvironment,
        CORS_ORIGIN: "http://localhost:3042",
      }[key];
    },
  };
}

function context(request, handler = function handler() {}) {
  return {
    getClass() { return class TestController {}; },
    getHandler() { return handler; },
    switchToHttp() { return { getRequest() { return request; } }; },
  };
}

test("password login creates a five-minute pending session without changing lastLoginAt", async () => {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  let pendingInput;
  const repository = {
    async findUserByEmail() { return { ...user(), passwordHash }; },
    async createPendingSession(input) { pendingInput = input; return session(); },
  };

  const before = Date.now();
  const result = await new LoginUseCase(repository).execute({
    email: "pending@example.test",
    password: PASSWORD,
    ipAddress: "127.0.0.1",
    userAgent: "activation-unit-test",
  });
  assert.equal(result.status, "AUTHENTICATED");
  assert.equal(result.user.lastLoginAt.toISOString(), "2026-08-30T00:00:00.000Z");
  assert.ok(pendingInput);
  assert.ok(pendingInput.expiresAt.getTime() >= before + (5 * 60 * 1_000) - 1_000);
  assert.ok(pendingInput.expiresAt.getTime() <= Date.now() + (5 * 60 * 1_000) + 1_000);
  assert.equal(Object.hasOwn(result, "sessionExpiresAt"), false);
});

test("SessionAuthGuard rejects a pending session before it can be touched or attached", async () => {
  let touched = false;
  const guard = new SessionAuthGuard(
    { getAllAndOverride() { return false; } },
    {
      async findSessionByTokenHash() { return session(); },
      async touchSession() { touched = true; },
    },
    config(),
  );
  const request = {
    method: "GET",
    url: "/api/v1/auth/me",
    headers: {},
    cookies: { lotus_session: "raw-session-token" },
  };
  await assert.rejects(() => guard.canActivate(context(request)), UnauthorizedException);
  assert.equal(touched, false);
  assert.equal(request.authUser, undefined);
  assert.equal(request.authSession, undefined);
});

test("pending activation guard binds the cookie and CSRF proof to the same session", async () => {
  const stored = session();
  const guard = new PendingSessionActivationGuard(
    { getAllAndOverride(key) { return key === AUTH_PENDING_SESSION_ACTIVATION_KEY; } },
    { async findSessionByTokenHash(hash) { return hash === stored.tokenHash ? stored : null; } },
    config(),
  );
  const request = {
    method: "POST",
    url: "/api/v1/auth/session/activate",
    headers: { origin: "http://localhost:3042", "x-csrf-token": "csrf-proof" },
    cookies: { lotus_session: "raw-session-token" },
  };
  assert.equal(await guard.canActivate(context(request)), true);
  assert.equal(request.authUser, undefined);
  assert.equal(request.authSession, undefined);
  assert.equal(request.pendingSessionActivation.userId, "user-1");
  assert.equal(request.pendingSessionActivation.tokenHash, stored.tokenHash);
  assert.equal(request.pendingSessionActivation.csrfTokenHash, stored.csrfTokenHash);

  await assert.rejects(
    () => guard.canActivate(context({
      ...request,
      headers: { origin: "http://localhost:3042", "x-csrf-token": "different-session-proof" },
      pendingSessionActivation: undefined,
    })),
    ForbiddenException,
  );
  await assert.rejects(
    () => guard.canActivate(context({
      ...request,
      body: { userId: "attacker-selected-user", sessionId: "attacker-selected-session" },
      pendingSessionActivation: undefined,
    })),
    BadRequestException,
  );
});

test("activation use case grants seven days only after the repository atomically accepts the proof", async () => {
  const calls = [];
  const useCase = new ActivateSessionUseCase({
    async activateSession(input) { calls.push(input); return "ACTIVATED"; },
  });
  const before = Date.now();
  await useCase.execute({ tokenHash: "session-hash", csrfTokenHash: "csrf-hash" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].expiresAt.getTime() >= before + (7 * 24 * 60 * 60 * 1_000) - 1_000);

  await assert.rejects(
    () => new ActivateSessionUseCase({ async activateSession() { return "CSRF_INVALID"; } }).execute({ tokenHash: "a", csrfTokenHash: "b" }),
    AuthSessionActivationCsrfError,
  );
  await assert.rejects(
    () => new ActivateSessionUseCase({ async activateSession() { return "UNAUTHORIZED"; } }).execute({ tokenHash: "a", csrfTokenHash: "b" }),
    AuthSessionActivationUnauthorizedError,
  );
});

test("activation is not public and its dedicated global guard runs before normal auth, authorization, and CSRF", async () => {
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, AuthController.prototype.activateSession), undefined);
  assert.equal(Reflect.getMetadata(AUTH_PENDING_SESSION_ACTIVATION_KEY, AuthController.prototype.activateSession), true);

  const appModule = fs.readFileSync(path.join(__dirname, "..", "src", "app.module.ts"), "utf8");
  const activationIndex = appModule.indexOf("useClass: PendingSessionActivationGuard");
  const sessionIndex = appModule.indexOf("useClass: SessionAuthGuard");
  const authorizationIndex = appModule.indexOf("useClass: AuthorizationGuard");
  const csrfIndex = appModule.indexOf("useClass: CsrfGuard");
  assert.ok(activationIndex >= 0 && activationIndex < sessionIndex);
  assert.ok(sessionIndex < authorizationIndex && authorizationIndex < csrfIndex);
});

test("normal global guards bypass only the dedicated activation boundary after its proof guard", async () => {
  const reflector = {
    getAllAndOverride(key) { return key === AUTH_PENDING_SESSION_ACTIVATION_KEY; },
  };
  const request = { method: "POST", url: "/api/v1/auth/session/activate", headers: {}, cookies: {} };
  const sessionGuard = new SessionAuthGuard(reflector, {
    async findSessionByTokenHash() { throw new Error("normal guard must not inspect activation cookie"); },
    async touchSession() { throw new Error("pending sessions are never touched"); },
  }, config());
  assert.equal(await sessionGuard.canActivate(context(request)), true);
  assert.equal(await new AuthorizationGuard(reflector, {
    async hasAllPermissions() { throw new Error("authorization must not run"); },
  }).canActivate(context(request)), true);
  assert.equal(await new CsrfGuard(reflector, {
    async isSessionCsrfTokenValid() { throw new Error("normal CSRF validation must not run"); },
  }, config()).canActivate(context(request)), true);
});
