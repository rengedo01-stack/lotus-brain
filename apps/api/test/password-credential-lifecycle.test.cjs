const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const { ConflictException, UnauthorizedException, UnprocessableEntityException } = require("@nestjs/common");

const {
  BootstrapUserUseCase,
  ChangePasswordUseCase,
} = require("../dist/modules/auth/application/auth.use-cases.js");
const { PasswordPolicy } = require("../dist/modules/auth/password.policy.js");
const {
  AuthConflictError,
  AuthInvalidCredentialsError,
  AuthValidationError,
} = require("../dist/modules/auth/auth.errors.js");
const { PrismaAuthRepository } = require("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
const { AuthController } = require("../dist/modules/auth/presentation/auth.controller.js");
const { AUTHENTICATED_ONLY_KEY } = require("../dist/modules/authorization/authorization.constants.js");

const CURRENT_PASSWORD = "current password is long enough";
const NEW_PASSWORD = "new password is also long enough";

test("PasswordPolicy uses Unicode code points, allows whitespace, and has no composition rule", () => {
  assert.throws(() => PasswordPolicy.assertPassword("a".repeat(14)), AuthValidationError);
  assert.doesNotThrow(() => PasswordPolicy.assertPassword("a".repeat(15)));
  assert.doesNotThrow(() => PasswordPolicy.assertPassword(" ".repeat(15)));
  assert.doesNotThrow(() => PasswordPolicy.assertPassword("😀".repeat(15)));
  assert.doesNotThrow(() => PasswordPolicy.assertPassword("a".repeat(128)));
  assert.throws(() => PasswordPolicy.assertPassword("a".repeat(129)), AuthValidationError);
  assert.throws(() => PasswordPolicy.assertChange(CURRENT_PASSWORD, CURRENT_PASSWORD), AuthValidationError);
});

test("bootstrap applies the shared PasswordPolicy only to newly set credentials", async () => {
  let captured;
  const repository = {
    async getUserCount() { return 0; },
    async bootstrapUser(input) {
      captured = input;
      return { id: "bootstrap-user", email: input.email, displayName: input.displayName, status: "ACTIVE" };
    },
  };
  await assert.rejects(
    () => new BootstrapUserUseCase(repository).execute({
      email: "bootstrap@review.local", displayName: "Bootstrap", password: "short password",
    }),
    AuthValidationError,
  );
  await new BootstrapUserUseCase(repository).execute({
    email: "bootstrap@review.local", displayName: "Bootstrap", password: NEW_PASSWORD,
  });
  assert.equal(await argon2.verify(captured.passwordHash, NEW_PASSWORD), true);
  assert.equal("password" in captured, false);
});

async function makeCredentialState(overrides = {}) {
  return {
    id: "user-1",
    passwordHash: await argon2.hash(CURRENT_PASSWORD, { type: argon2.argon2id }),
    credentialVersion: 1,
    status: "ACTIVE",
    deletedAt: null,
    sessions: [{ id: "session-a", revokedAt: null }, { id: "session-b", revokedAt: null }],
    audit: [],
    ...overrides,
  };
}

function stateRepository(state, overrides = {}) {
  return {
    async findUserCredentialById() {
      return {
        id: state.id,
        passwordHash: state.passwordHash,
        credentialVersion: state.credentialVersion,
        status: state.status,
        deletedAt: state.deletedAt,
      };
    },
    async changePassword(input) {
      if (
        state.status !== "ACTIVE" ||
        state.deletedAt !== null
      ) {
        throw new AuthInvalidCredentialsError("Invalid credentials.");
      }
      if (input.expectedCredentialVersion !== state.credentialVersion) {
        throw new AuthConflictError("Credential state changed.");
      }
      state.passwordHash = input.passwordHash;
      state.credentialVersion += 1;
      for (const session of state.sessions) session.revokedAt = new Date();
      state.audit.push({
        action: "CHANGE_PASSWORD",
        actorUserId: state.id,
        targetUserId: state.id,
        beforeState: { credentialVersion: input.expectedCredentialVersion },
        afterState: { credentialVersion: input.expectedCredentialVersion + 1 },
      });
    },
    ...overrides,
  };
}

test("self-service password change verifies the current password and invalidates all sessions", async () => {
  const state = await makeCredentialState();
  await new ChangePasswordUseCase(stateRepository(state)).execute({
    userId: state.id,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
  });

  assert.equal(await argon2.verify(state.passwordHash, CURRENT_PASSWORD), false);
  assert.equal(await argon2.verify(state.passwordHash, NEW_PASSWORD), true);
  assert.equal(state.credentialVersion, 2);
  assert.equal(state.sessions.every(({ revokedAt }) => revokedAt instanceof Date), true);
  assert.deepEqual(state.audit, [{
    action: "CHANGE_PASSWORD",
    actorUserId: state.id,
    targetUserId: state.id,
    beforeState: { credentialVersion: 1 },
    afterState: { credentialVersion: 2 },
  }]);
  assert.equal(JSON.stringify(state.audit).includes(CURRENT_PASSWORD), false);
  assert.equal(JSON.stringify(state.audit).includes(NEW_PASSWORD), false);
  assert.equal(JSON.stringify(state.audit).includes(state.passwordHash), false);
});

test("wrong current password and ineligible users cannot change credentials", async () => {
  const active = await makeCredentialState();
  await assert.rejects(
    () => new ChangePasswordUseCase(stateRepository(active)).execute({
      userId: active.id,
      currentPassword: "wrong current password long enough",
      newPassword: NEW_PASSWORD,
    }),
    AuthInvalidCredentialsError,
  );
  assert.equal(active.credentialVersion, 1);
  assert.equal(active.sessions.every(({ revokedAt }) => revokedAt === null), true);

  for (const overrides of [
    { status: "DISABLED" },
    { status: "LOCKED" },
    { deletedAt: new Date("2026-08-13T00:00:00.000Z") },
  ]) {
    const state = await makeCredentialState(overrides);
    await assert.rejects(
      () => new ChangePasswordUseCase(stateRepository(state)).execute({
        userId: state.id,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
      AuthInvalidCredentialsError,
    );
    assert.equal(state.credentialVersion, 1);
  }
});

function transactionalRepositoryState({ failAudit = false, failRevoke = false } = {}) {
  const state = {
    user: { id: "user-1", credentialVersion: 1, status: "ACTIVE", deletedAt: null, passwordHash: "old-hash" },
    sessions: [{ userId: "user-1", revokedAt: null }, { userId: "user-1", revokedAt: null }],
    audit: [],
  };
  const prisma = {
    async $transaction(work) {
      const backup = structuredClone(state);
      const transaction = {
        user: {
          async updateMany({ where, data }) {
            if (
              where.id !== state.user.id ||
              where.credentialVersion !== state.user.credentialVersion ||
              state.user.status !== "ACTIVE" ||
              state.user.deletedAt !== null
            ) return { count: 0 };
            state.user.passwordHash = data.passwordHash;
            state.user.credentialVersion += data.credentialVersion.increment;
            return { count: 1 };
          },
          async findUnique() {
            return { status: state.user.status, deletedAt: state.user.deletedAt };
          },
        },
        identitySession: {
          async updateMany() {
            if (failRevoke) throw new Error("forced session revoke failure");
            for (const session of state.sessions) session.revokedAt = new Date();
            return { count: state.sessions.length };
          },
        },
        identityAuditLog: {
          async create({ data }) {
            if (failAudit) throw new Error("forced audit failure");
            state.audit.push(data);
          },
        },
      };
      try {
        return await work(transaction);
      } catch (error) {
        Object.assign(state, backup);
        throw error;
      }
    },
  };
  return { state, repository: new PrismaAuthRepository(prisma) };
}

test("audit or session-revocation failure rolls back the password and credential version", async () => {
  for (const failure of [{ failAudit: true }, { failRevoke: true }]) {
    const { state, repository } = transactionalRepositoryState(failure);
    await assert.rejects(
      () => repository.changePassword({ userId: "user-1", expectedCredentialVersion: 1, passwordHash: "new-hash" }),
    );
    assert.deepEqual(state.user, {
      id: "user-1", credentialVersion: 1, status: "ACTIVE", deletedAt: null, passwordHash: "old-hash",
    });
    assert.equal(state.sessions.every(({ revokedAt }) => revokedAt === null), true);
    assert.deepEqual(state.audit, []);
  }
});

test("concurrent password changes use credential-version compare-and-swap", async () => {
  const state = await makeCredentialState();
  let waiting = 0;
  let releaseReads;
  const readsReady = new Promise((resolve) => { releaseReads = resolve; });
  const repository = stateRepository(state, {
    async findUserCredentialById() {
      waiting += 1;
      if (waiting === 2) releaseReads();
      await readsReady;
      return {
        id: state.id,
        passwordHash: state.passwordHash,
        credentialVersion: 1,
        status: "ACTIVE",
        deletedAt: null,
      };
    },
  });
  const useCase = new ChangePasswordUseCase(repository);
  const outcomes = await Promise.allSettled([
    useCase.execute({ userId: state.id, currentPassword: CURRENT_PASSWORD, newPassword: "first new password long enough" }),
    useCase.execute({ userId: state.id, currentPassword: CURRENT_PASSWORD, newPassword: "second new password long enough" }),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(state.credentialVersion, 2);
  assert.equal(state.audit.length, 1);
  const winner = await Promise.any([
    argon2.verify(state.passwordHash, "first new password long enough").then((ok) => ok ? "first" : Promise.reject()),
    argon2.verify(state.passwordHash, "second new password long enough").then((ok) => ok ? "second" : Promise.reject()),
  ]);
  assert.ok(["first", "second"].includes(winner));
});

test("password-change controller derives target only from the authenticated request and maps safe errors", async () => {
  const calls = [];
  const controller = new AuthController(
    { get: () => "development" },
    {},
    { async execute(input) { calls.push(input); } },
    {},
    {},
    {},
  );
  const response = { clearCookie() {}, setHeader() {} };
  assert.deepEqual(
    await controller.changePassword(
      { authUser: { id: "session-actor" } },
      { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, actorUserId: "spoofed" },
      response,
    ),
    { status: "ok" },
  );
  assert.deepEqual(calls, [{ userId: "session-actor", currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }]);
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, AuthController.prototype.changePassword), true);

  for (const [error, expected] of [
    [new AuthInvalidCredentialsError("Invalid credentials."), UnauthorizedException],
    [new AuthConflictError("conflict"), ConflictException],
    [new AuthValidationError("invalid"), UnprocessableEntityException],
  ]) {
    const failing = new AuthController(
      { get: () => "development" }, {}, { async execute() { throw error; } }, {}, {}, {},
    );
    await assert.rejects(
      () => failing.changePassword({ authUser: { id: "session-actor" } }, {
        currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD,
      }, response),
      expected,
    );
  }
});
