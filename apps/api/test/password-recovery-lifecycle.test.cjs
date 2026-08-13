const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const { BadRequestException, UnprocessableEntityException } = require("@nestjs/common");

const { AuthValidationError } = require("../dist/modules/auth/auth.errors.js");
const { hashSecret } = require("../dist/modules/auth/auth.utils.js");
const { AUTH_PUBLIC_KEY } = require("../dist/modules/auth/auth.constants.js");
const { NotificationOutboxWorker } = require("../dist/modules/notification/application/notification-outbox.worker.js");
const { PasswordRecoveryService } = require("../dist/modules/notification/application/password-recovery.service.js");
const { PasswordRecoveryTokenInvalidError } = require("../dist/modules/notification/application/recovery-channel.errors.js");
const { makePasswordRecoveryUrl } = require("../dist/modules/notification/notification.url.js");
const { PasswordRecoveryController } = require("../dist/modules/notification/presentation/password-recovery.controller.js");

const CURRENT_PASSWORD = "current recovery password is long enough";
const NEW_PASSWORD = "replacement recovery password is long enough";

test("password recovery uses canonical email normalization and leaves request targeting inside the repository", async () => {
  let requestedEmail;
  const service = new PasswordRecoveryService({
    async requestPasswordRecovery(email) { requestedEmail = email; },
  });
  await service.request("  Recovery.User@Example.Test ");
  assert.equal(requestedEmail, "recovery.user@example.test");
});

test("password reset hashes only after a reusable PasswordPolicy check and passes only a digest to the repository", async () => {
  const currentHash = await argon2.hash(CURRENT_PASSWORD, { type: argon2.argon2id });
  const rawToken = "A".repeat(43);
  let preparationHash;
  let completed;
  const service = new PasswordRecoveryService({
    async preparePasswordReset(tokenHash) {
      preparationHash = tokenHash;
      return { passwordHash: currentHash };
    },
    async completePasswordReset(input) { completed = input; },
  });

  await service.reset(rawToken, NEW_PASSWORD);
  assert.equal(preparationHash, hashSecret(rawToken));
  assert.equal(completed.tokenHash, hashSecret(rawToken));
  assert.equal(await argon2.verify(completed.passwordHash, NEW_PASSWORD), true);
  assert.equal(JSON.stringify(completed).includes(rawToken), false);
  assert.equal(JSON.stringify(completed).includes(NEW_PASSWORD), false);
});

test("invalid recovery credentials and same-password attempts cannot complete a reset", async () => {
  const currentHash = await argon2.hash(CURRENT_PASSWORD, { type: argon2.argon2id });
  let completed = 0;
  const invalidService = new PasswordRecoveryService({
    async preparePasswordReset() { return null; },
    async completePasswordReset() { completed += 1; },
  });
  await assert.rejects(
    () => invalidService.reset("B".repeat(43), NEW_PASSWORD),
    PasswordRecoveryTokenInvalidError,
  );

  const samePasswordService = new PasswordRecoveryService({
    async preparePasswordReset() { return { passwordHash: currentHash }; },
    async completePasswordReset() { completed += 1; },
  });
  await assert.rejects(
    () => samePasswordService.reset("C".repeat(43), CURRENT_PASSWORD),
    AuthValidationError,
  );
  assert.equal(completed, 0);
});

test("password recovery endpoints are public, generic, and never accept a client-selected user", async () => {
  const calls = [];
  const controller = new PasswordRecoveryController({
    async request(email) { calls.push(["request", email]); },
    async reset(token, newPassword) {
      calls.push(["reset", token, newPassword]);
      if (token === "invalid") throw new PasswordRecoveryTokenInvalidError("internal detail");
      if (token === "policy") throw new AuthValidationError("policy detail");
    },
  });

  assert.deepEqual(await controller.request({ email: "person@example.test" }), { status: "accepted" });
  assert.deepEqual(await controller.reset({ token: "D".repeat(43), newPassword: NEW_PASSWORD }), { status: "ok" });
  await assert.rejects(
    () => controller.reset({ token: "invalid", newPassword: NEW_PASSWORD }),
    (error) => error instanceof BadRequestException && error.message === "Recovery credential is invalid or expired.",
  );
  await assert.rejects(
    () => controller.reset({ token: "policy", newPassword: NEW_PASSWORD }),
    (error) => error instanceof UnprocessableEntityException && error.message === "policy detail",
  );
  assert.deepEqual(calls[0], ["request", "person@example.test"]);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, PasswordRecoveryController.prototype.request), true);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, PasswordRecoveryController.prototype.reset), true);
});

test("password recovery URLs use the trusted base URL and keep the secret in the fragment", () => {
  const rawToken = "E".repeat(43);
  const url = new URL(makePasswordRecoveryUrl("https://trusted.example.test/app", rawToken));
  assert.equal(url.origin, "https://trusted.example.test");
  assert.equal(url.pathname, "/reset-password");
  assert.equal(url.search, "");
  assert.equal(url.hash, `#token=${rawToken}`);
});

test("worker keeps recovery tokens in delivery memory and completion notices contain no credential", async () => {
  const rawToken = "F".repeat(43);
  const calls = [];
  const repository = {
    async claimDueEmailVerification() {
      return {
        id: calls.length === 0 ? "recovery-outbox" : "completed-outbox",
        kind: calls.length === 0 ? "PASSWORD_RECOVERY" : "PASSWORD_RESET_COMPLETED",
        userId: "user-1",
        destinationAddress: "user@example.test",
        emailVersionSnapshot: 1,
        credentialVersionSnapshot: 1,
        attemptCount: 1,
      };
    },
    async preparePasswordRecoveryDelivery() {
      calls.push("prepare-recovery");
      return { destinationAddress: "user@example.test", expiresAt: new Date("2026-08-13T01:00:00.000Z"), rawToken };
    },
    async preparePasswordResetCompletedDelivery() {
      calls.push("prepare-completed");
      return { destinationAddress: "user@example.test" };
    },
    async markEmailVerificationSent(id) { calls.push(`sent:${id}`); },
    async markEmailVerificationFailed() { calls.push("failed"); },
  };
  const sent = [];
  const notifier = {
    async sendPasswordRecovery(delivery) { sent.push(["recovery", delivery]); },
    async sendPasswordResetCompleted(delivery) { sent.push(["completed", delivery]); },
  };
  const worker = new NotificationOutboxWorker(repository, notifier, { get: () => "https://trusted.example.test" });
  assert.equal(await worker.processOne(new Date("2026-08-13T00:00:00.000Z")), true);
  assert.equal(await worker.processOne(new Date("2026-08-13T00:00:01.000Z")), true);
  assert.equal(sent.length, 2);
  assert.match(sent[0][1].recoveryUrl, new RegExp(`#token=${rawToken}$`));
  assert.deepEqual(sent[1][1], { destinationAddress: "user@example.test" });
  assert.equal(JSON.stringify(sent[1][1]).includes(rawToken), false);
  assert.deepEqual(calls, [
    "prepare-recovery",
    "sent:recovery-outbox",
    "prepare-completed",
    "sent:completed-outbox",
  ]);
});
