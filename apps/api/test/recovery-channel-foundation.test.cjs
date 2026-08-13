const test = require("node:test");
const assert = require("node:assert/strict");
const { BadRequestException, UnauthorizedException } = require("@nestjs/common");

const { validateEnvironment } = require("../dist/config/environment.js");
const { hashSecret } = require("../dist/modules/auth/auth.utils.js");
const { AUTH_PUBLIC_KEY } = require("../dist/modules/auth/auth.constants.js");
const { AUTHENTICATED_ONLY_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { EmailVerificationService } = require("../dist/modules/notification/application/email-verification.service.js");
const { NotificationDeliveryError } = require("../dist/modules/notification/application/email-notifier.js");
const { NotificationOutboxWorker } = require("../dist/modules/notification/application/notification-outbox.worker.js");
const { EmailVerificationTokenInvalidError } = require("../dist/modules/notification/application/recovery-channel.errors.js");
const { makeVerificationUrl } = require("../dist/modules/notification/notification.url.js");
const { EmailVerificationController } = require("../dist/modules/notification/presentation/email-verification.controller.js");
const { SmtpEmailNotifier } = require("../dist/modules/notification/infrastructure/smtp-email-notifier.js");

test("production recovery-channel configuration requires HTTPS canonical web and SMTP", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:password@localhost:5432/review",
    CORS_ORIGIN: "https://app.example.test",
    LOG_LEVEL: "info",
    PORT: "3001",
    PUBLIC_WEB_BASE_URL: "https://app.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "Lotus BRAIN <no-reply@example.test>",
    WEBAUTHN_RP_NAME: "Lotus BRAIN",
    WEBAUTHN_RP_ID: "example.test",
    WEBAUTHN_ORIGIN: "https://app.example.test",
  };
  assert.doesNotThrow(() => validateEnvironment(base));
  assert.throws(() => validateEnvironment({ ...base, PUBLIC_WEB_BASE_URL: "http://app.example.test" }));
  assert.throws(() => validateEnvironment({ ...base, SMTP_PASSWORD: undefined }));
  assert.throws(() => validateEnvironment({ ...base, SMTP_SECURE: "not-a-boolean" }));
});

test("SMTP notifier uses the CommonJS transport with required TLS and certificate verification", async () => {
  const nodemailer = require("nodemailer");
  const originalCreateTransport = nodemailer.createTransport;
  let transportOptions;
  let message;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return { async sendMail(input) { message = input; } };
  };
  try {
    const values = {
      SMTP_FROM: "Lotus BRAIN <no-reply@example.test>",
      SMTP_HOST: "smtp.example.test",
      SMTP_PASSWORD: "smtp-password",
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: "smtp-user",
    };
    const notifier = new SmtpEmailNotifier({ get: (key) => values[key] });
    await notifier.sendEmailVerification({
      destinationAddress: "recipient@example.test",
      expiresAt: new Date("2026-08-13T01:00:00.000Z"),
      verificationUrl: "https://trusted.example.test/verify-email#token=secret-is-not-logged",
    });
    assert.equal(transportOptions.requireTLS, true);
    assert.equal(transportOptions.tls.rejectUnauthorized, true);
    assert.equal(transportOptions.logger, false);
    assert.equal(transportOptions.debug, false);
    assert.equal(message.to, "recipient@example.test");
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test("verification URL is based exclusively on trusted configuration and keeps the token in the fragment", () => {
  const rawToken = "A".repeat(43);
  const url = new URL(makeVerificationUrl("https://trusted.example.test/app", rawToken));
  assert.equal(url.origin, "https://trusted.example.test");
  assert.equal(url.pathname, "/verify-email");
  assert.equal(url.search, "");
  assert.equal(url.hash, `#token=${rawToken}`);
});

test("verification service digests the public token before repository lookup", async () => {
  let receivedHash;
  const service = new EmailVerificationService({
    async requestEmailVerification() {},
    async confirmEmailVerification(tokenHash) { receivedHash = tokenHash; },
  });
  await service.confirm("verification-credential");
  assert.equal(receivedHash, hashSecret("verification-credential"));
  assert.notEqual(receivedHash, "verification-credential");
});

test("verification endpoints derive request target from the current session and return generic token errors", async () => {
  const calls = [];
  const controller = new EmailVerificationController({
    async request(userId) { calls.push(["request", userId]); },
    async confirm(token) {
      calls.push(["confirm", token]);
      if (token === "bad") throw new EmailVerificationTokenInvalidError("internal detail");
    },
  });
  assert.deepEqual(await controller.request({ authUser: { id: "session-user" } }, {}), { status: "accepted" });
  await controller.confirm({ token: "A".repeat(43) });
  assert.deepEqual(calls, [["request", "session-user"], ["confirm", "A".repeat(43)]]);
  await assert.rejects(() => controller.request({}, {}), UnauthorizedException);
  await assert.rejects(
    () => controller.confirm({ token: "bad" }),
    (error) => error instanceof BadRequestException && error.message === "Verification token is invalid or expired.",
  );
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, EmailVerificationController.prototype.request), true);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, EmailVerificationController.prototype.confirm), true);
});

test("outbox worker creates a token only in delivery memory and records a sent attempt without logging it", async () => {
  const rawToken = "B".repeat(43);
  const calls = [];
  const claim = {
    id: "outbox-1", userId: "user-1", destinationAddress: "user@example.test", emailVersionSnapshot: 1, attemptCount: 1,
  };
  const repository = {
    async claimDueEmailVerification() { return claim; },
    async prepareEmailVerificationDelivery() {
      calls.push("prepare");
      return { destinationAddress: "user@example.test", rawToken, expiresAt: new Date("2026-08-13T01:00:00.000Z") };
    },
    async markEmailVerificationSent() { calls.push("sent"); },
    async markEmailVerificationFailed() { calls.push("failed"); },
  };
  const deliveries = [];
  const worker = new NotificationOutboxWorker(
    repository,
    { async sendEmailVerification(delivery) { deliveries.push(delivery); } },
    { get: () => "https://trusted.example.test" },
  );
  assert.equal(await worker.processOne(new Date("2026-08-13T00:00:00.000Z")), true);
  assert.deepEqual(calls, ["prepare", "sent"]);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].verificationUrl, new RegExp(`#token=${rawToken}$`));
  assert.equal(Object.prototype.hasOwnProperty.call(claim, "rawToken"), false);
});

test("outbox worker retries bounded delivery failures with only an error classification", async () => {
  const calls = [];
  const claim = {
    id: "outbox-2", userId: "user-2", destinationAddress: "user@example.test", emailVersionSnapshot: 1, attemptCount: 1,
  };
  const repository = {
    async claimDueEmailVerification() { return claim; },
    async prepareEmailVerificationDelivery() {
      return { destinationAddress: "user@example.test", rawToken: "C".repeat(43), expiresAt: new Date() };
    },
    async markEmailVerificationSent() { calls.push("sent"); },
    async markEmailVerificationFailed(_claim, _worker, _now, code, nextAttemptAt) {
      calls.push({ code, hasRetry: nextAttemptAt instanceof Date });
    },
  };
  const worker = new NotificationOutboxWorker(
    repository,
    { async sendEmailVerification() { throw new NotificationDeliveryError("CONNECTION_FAILURE"); } },
    { get: () => "https://trusted.example.test" },
  );
  assert.equal(await worker.processOne(), true);
  assert.deepEqual(calls, [{ code: "CONNECTION_FAILURE", hasRetry: true }]);
});
