const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const { BadRequestException, ConflictException, UnprocessableEntityException } = require("@nestjs/common");

const { UserInvitationService } = require("../dist/modules/identity/application/user-invitation.service.js");
const {
  UserInvitationAdministrationController,
  UserInvitationAcceptanceController,
} = require("../dist/modules/identity/presentation/user-invitation.controller.js");
const { AuthValidationError } = require("../dist/modules/auth/auth.errors.js");
const { Public } = require("../dist/modules/auth/decorators/public.decorator.js");
const { AUTH_PUBLIC_KEY } = require("../dist/modules/auth/auth.constants.js");
const { REQUIRED_PERMISSIONS_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { Permissions } = require("../dist/modules/authorization/permission.registry.js");
const {
  UserInvitationConflictError,
  UserInvitationCredentialInvalidError,
} = require("../dist/modules/notification/application/user-invitation.errors.js");
const { makeUserInvitationUrl } = require("../dist/modules/notification/notification.url.js");
const { SmtpEmailNotifier } = require("../dist/modules/notification/infrastructure/smtp-email-notifier.js");

test("invitation service canonicalizes the admin-supplied email, hashes only after password validation, and never accepts roles", async () => {
  const calls = [];
  const repository = {
    async createInvitation(input) { calls.push(input); return { id: "inv-1", ...input, status: "PENDING" }; },
    async acceptInvitation(input) { calls.push(input); },
  };
  const service = new UserInvitationService(repository);

  await service.createInvitation("actual-admin", " Invitee@Example.Test ");
  assert.deepEqual(calls[0], { actorUserId: "actual-admin", email: "invitee@example.test" });
  await assert.rejects(() => service.acceptInvitation("x".repeat(43), "short"), AuthValidationError);
  assert.equal(calls.length, 1);

  const password = "a valid invitation password is long enough";
  await service.acceptInvitation("x".repeat(43), password);
  assert.equal(calls.length, 2);
  assert.equal(Object.hasOwn(calls[1], "password"), false);
  assert.equal(Object.hasOwn(calls[1], "token"), false);
  assert.equal(calls[1].tokenHash.length, 64);
  assert.equal(await argon2.verify(calls[1].passwordHash, password), true);
});

test("invitation controllers enforce identity.manage, derive the actor from the session, and return no session data", async () => {
  const calls = [];
  const service = {
    async createInvitation(actorUserId, email) { calls.push({ type: "create", actorUserId, email }); return { id: "inv-1" }; },
    async listInvitations(query) { calls.push({ type: "list", query }); return []; },
    async getInvitation(id) { calls.push({ type: "get", id }); return { id }; },
    async cancelInvitation(id, actorUserId) { calls.push({ type: "cancel", id, actorUserId }); return { id }; },
    async resendInvitation(id, actorUserId) { calls.push({ type: "resend", id, actorUserId }); },
    async acceptInvitation(token, password) { calls.push({ type: "accept", token, password }); },
  };
  const admin = new UserInvitationAdministrationController(service);
  const acceptance = new UserInvitationAcceptanceController(service);

  assert.deepEqual(
    await admin.create({ authUser: { id: "actual-admin" } }, { email: "invitee@example.test", roleCode: "SYSTEM_ADMIN" }),
    { id: "inv-1" },
  );
  await admin.cancel({ authUser: { id: "actual-admin" } }, "inv-1");
  assert.deepEqual(await admin.resend({ authUser: { id: "actual-admin" } }, "inv-1"), { status: "accepted" });
  assert.deepEqual(await acceptance.accept({ token: "x".repeat(43), password: "a valid invitation password is long enough" }), { status: "ok" });
  assert.equal(calls.some((call) => call.actorUserId === "SYSTEM_ADMIN"), false);
  assert.deepEqual(calls.filter((call) => call.type === "create")[0], {
    type: "create", actorUserId: "actual-admin", email: "invitee@example.test",
  });
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UserInvitationAdministrationController.prototype.create), [Permissions.IDENTITY_MANAGE]);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, UserInvitationAcceptanceController.prototype.accept), true);
});

test("invitation controllers map lifecycle and credential errors without leaking internal state", async () => {
  const admin = new UserInvitationAdministrationController({
    async getInvitation() { throw new UserInvitationConflictError("pending invite detail"); },
  });
  const acceptance = new UserInvitationAcceptanceController({
    async acceptInvitation() { throw new UserInvitationCredentialInvalidError("raw token detail"); },
  });
  const policy = new UserInvitationAcceptanceController({
    async acceptInvitation() { throw new AuthValidationError("Password policy error."); },
  });
  await assert.rejects(() => admin.get("inv-1"), ConflictException);
  await assert.rejects(() => acceptance.accept({ token: "x".repeat(43), password: "a valid invitation password is long enough" }), BadRequestException);
  await assert.rejects(() => policy.accept({ token: "x".repeat(43), password: "a valid invitation password is long enough" }), UnprocessableEntityException);
});

test("invitation URLs use only trusted configuration and leave the credential in the fragment", () => {
  const rawToken = "x".repeat(43);
  const url = new URL(makeUserInvitationUrl("https://trusted.example.test/base/path", rawToken));
  assert.equal(url.origin, "https://trusted.example.test");
  assert.equal(url.pathname, "/accept-invitation");
  assert.equal(url.search, "");
  assert.equal(url.hash, `#token=${rawToken}`);
});

test("invitation mail uses the TLS notifier and contains only the trusted activation link", async () => {
  const nodemailer = require("nodemailer");
  const originalCreateTransport = nodemailer.createTransport;
  let transportOptions;
  let message;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return { async sendMail(input) { message = input; } };
  };
  try {
    const notifier = new SmtpEmailNotifier({
      get: (key) => ({
        SMTP_FROM: "Lotus BRAIN <no-reply@example.test>",
        SMTP_HOST: "smtp.example.test",
        SMTP_PASSWORD: "smtp-password",
        SMTP_PORT: 465,
        SMTP_SECURE: true,
        SMTP_USER: "smtp-user",
      })[key],
    });
    await notifier.sendUserInvitation({
      destinationAddress: "recipient@example.test",
      expiresAt: new Date("2026-08-14T01:00:00.000Z"),
      invitationUrl: "https://trusted.example.test/accept-invitation#token=delivery-only-token",
    });
    assert.equal(transportOptions.requireTLS, true);
    assert.equal(transportOptions.tls.rejectUnauthorized, true);
    assert.equal(message.to, "recipient@example.test");
    assert.equal(message.text.includes("delivery-only-token"), true);
    assert.equal(message.text.toLowerCase().includes("role"), false);
    assert.equal(message.text.toLowerCase().includes("password"), false);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});
