const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");

const {
  LoginUseCase,
  BootstrapUserUseCase,
} = require("../dist/modules/auth/application/auth.use-cases.js");
const { AuthInvalidCredentialsError, AuthForbiddenError } = require("../dist/modules/auth/auth.errors.js");
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
