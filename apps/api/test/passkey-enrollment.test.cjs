const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const { UnauthorizedException } = require("@nestjs/common");

const { validateEnvironment } = require("../dist/config/environment.js");
const { AuthInvalidCredentialsError } = require("../dist/modules/auth/auth.errors.js");
const { PasskeyCeremonyInvalidError } = require("../dist/modules/auth/application/passkey-enrollment.errors.js");
const { PasskeyEnrollmentService } = require("../dist/modules/auth/application/passkey-enrollment.service.js");
const { PasskeyController } = require("../dist/modules/auth/presentation/passkey.controller.js");
const { AUTHENTICATED_ONLY_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { AUTH_PUBLIC_KEY } = require("../dist/modules/auth/auth.constants.js");

const PASSWORD = "current passkey enrollment password";

function config(overrides = {}) {
  return {
    get(key) {
      return {
        WEBAUTHN_ORIGIN: "http://localhost:3000",
        WEBAUTHN_RP_ID: "localhost",
        WEBAUTHN_RP_NAME: "Lotus BRAIN",
      }[key];
    },
    ...overrides,
  };
}

async function activeReauthentication() {
  return {
    userId: "user-1",
    passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    credentialVersion: 7,
    status: "ACTIVE",
    deletedAt: null,
  };
}

async function enrollmentHarness({ verificationError } = {}) {
  const material = await activeReauthentication();
  const events = [];
  const repository = {
    async getReauthenticationMaterial(userId, sessionId) {
      events.push(["reauth", userId, sessionId]);
      return material;
    },
    async beginRegistration(input) {
      events.push(["begin", input]);
      return {
        email: "user@example.test",
        displayName: "User",
        activeCredentials: [{ credentialId: "existing-credential", transports: ["internal"] }],
      };
    },
    async claimRegistrationChallenge(input) {
      events.push(["claim", input]);
      return { challengeId: "challenge-1" };
    },
    async completeRegistration(input) {
      events.push(["complete", input]);
      return { id: "passkey-1", displayName: null, transports: ["internal"], revokedAt: null };
    },
    async listPasskeys(userId) {
      events.push(["list", userId]);
      return [{ id: "passkey-1", displayName: null, transports: ["internal"], revokedAt: null }];
    },
    async renamePasskey(input) {
      events.push(["rename", input]);
      return { id: input.passkeyId, displayName: input.displayName, transports: ["internal"], revokedAt: null };
    },
    async revokePasskey(input) {
      events.push(["revoke", input]);
      return { id: input.passkeyId, displayName: null, transports: ["internal"], revokedAt: new Date() };
    },
  };
  const webAuthn = {
    extractChallenge(response) {
      events.push(["extract", response]);
      return response.challenge;
    },
    async generateRegistrationOptions(input) {
      events.push(["options", input]);
      return { challenge: input.challenge, rp: { id: input.rpId, name: input.rpName } };
    },
    async verifyRegistrationResponse(input) {
      events.push(["verify", input]);
      if (verificationError !== undefined) throw verificationError;
      return {
        credentialId: "credential-1",
        publicKey: Uint8Array.from([1, 2, 3]),
        counter: 4n,
        transports: ["internal"],
        deviceType: "multiDevice",
        backedUp: true,
      };
    },
  };
  return { events, repository, webAuthn, service: new PasskeyEnrollmentService(repository, webAuthn, config()) };
}

test("WebAuthn configuration uses startup-trusted RP values and rejects unsafe production or RP/origin combinations", () => {
  const base = {
    DATABASE_URL: "postgresql://user:password@localhost:5432/lotus?schema=public",
    NODE_ENV: "production",
    PORT: "3001",
    CORS_ORIGIN: "https://app.example.test",
    LOG_LEVEL: "info",
    PUBLIC_WEB_BASE_URL: "https://app.example.test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-password",
    SMTP_FROM: "Lotus BRAIN <no-reply@example.test>",
    WEBAUTHN_RP_NAME: "Lotus BRAIN",
    WEBAUTHN_RP_ID: "example.test",
    WEBAUTHN_ORIGIN: "https://app.example.test",
  };
  const trusted = validateEnvironment(base);
  assert.equal(trusted.WEBAUTHN_RP_ID, "example.test");
  assert.equal(trusted.WEBAUTHN_ORIGIN, "https://app.example.test");

  assert.throws(() => validateEnvironment({ ...base, WEBAUTHN_ORIGIN: "http://app.example.test" }), /HTTPS/i);
  assert.throws(() => validateEnvironment({ ...base, WEBAUTHN_RP_ID: "attacker.example.test" }), /suffix/i);
  assert.throws(() => validateEnvironment({ ...base, WEBAUTHN_ORIGIN: "https://app.example.test/path" }), /without a path/i);
  assert.throws(() => validateEnvironment({ ...base, WEBAUTHN_RP_ID: undefined }), /WEBAUTHN_RP_ID/i);
  assert.throws(() => validateEnvironment({
    ...base,
    NODE_ENV: "development",
    WEBAUTHN_ORIGIN: "http://dev.example.test",
    WEBAUTHN_RP_ID: "example.test",
  }), /localhost/i);
});

test("begin registration re-authenticates the session user before writing only a challenge digest", async () => {
  const { events, service } = await enrollmentHarness();
  const options = await service.beginRegistration({
    userId: "user-1",
    identitySessionId: "session-1",
    currentPassword: PASSWORD,
  });
  const begin = events.find(([kind]) => kind === "begin")[1];
  const optionsCall = events.find(([kind]) => kind === "options")[1];
  assert.equal(begin.userId, "user-1");
  assert.equal(begin.identitySessionId, "session-1");
  assert.equal(begin.expectedCredentialVersion, 7);
  assert.match(begin.challengeHash, /^[a-f0-9]{64}$/);
  assert.equal(begin.challengeHash === options.challenge, false);
  assert.equal(options.rp.id, "localhost");
  assert.equal(optionsCall.context.activeCredentials[0].credentialId, "existing-credential");
});

test("wrong current password creates neither a challenge nor a passkey and does not allow revoke", async () => {
  const { events, service } = await enrollmentHarness();
  await assert.rejects(
    () => service.beginRegistration({ userId: "user-1", identitySessionId: "session-1", currentPassword: "wrong password" }),
    AuthInvalidCredentialsError,
  );
  await assert.rejects(
    () => service.revokePasskey({ userId: "user-1", identitySessionId: "session-1", passkeyId: "passkey-1", currentPassword: "wrong password" }),
    AuthInvalidCredentialsError,
  );
  assert.equal(events.some(([kind]) => kind === "begin" || kind === "revoke"), false);
});

test("registration uses the challenge-derived current user and session, then saves only verified credential data", async () => {
  const { events, service } = await enrollmentHarness();
  const result = await service.verifyRegistration({
    userId: "user-1",
    identitySessionId: "session-1",
    registrationResponse: { challenge: "challenge-from-client-data", actorUserId: "spoofed", userId: "spoofed" },
  });
  const claim = events.find(([kind]) => kind === "claim")[1];
  const verification = events.find(([kind]) => kind === "verify")[1];
  const completion = events.find(([kind]) => kind === "complete")[1];
  assert.equal(claim.userId, "user-1");
  assert.equal(claim.identitySessionId, "session-1");
  assert.equal(verification.expectedOrigin, "http://localhost:3000");
  assert.equal(verification.expectedRpId, "localhost");
  assert.equal(completion.credential.credentialId, "credential-1");
  assert.equal("registrationResponse" in completion, false);
  assert.equal(result.id, "passkey-1");
});

test("a cryptographic registration failure leaves no credential completion attempt after the single-use claim", async () => {
  const { events, service } = await enrollmentHarness({
    verificationError: new PasskeyCeremonyInvalidError("invalid"),
  });
  await assert.rejects(
    () => service.verifyRegistration({
      userId: "user-1", identitySessionId: "session-1", registrationResponse: { challenge: "challenge" },
    }),
    PasskeyCeremonyInvalidError,
  );
  assert.equal(events.some(([kind]) => kind === "claim"), true);
  assert.equal(events.some(([kind]) => kind === "complete"), false);
});

test("passkey name normalization and self-service controller derive user and session only from authentication", async () => {
  const { events, service } = await enrollmentHarness();
  await service.renamePasskey({
    userId: "user-1", identitySessionId: "session-1", passkeyId: "passkey-1", displayName: "  Office\u0301 key  ",
  });
  const rename = events.find(([kind]) => kind === "rename")[1];
  assert.equal(rename.displayName, "Officé key");

  const calls = [];
  const controller = new PasskeyController({
    async beginRegistration(input) { calls.push(["begin", input]); return { challenge: "safe" }; },
    async verifyRegistration(input) { calls.push(["verify", input]); return { id: "passkey-1" }; },
    async renamePasskey(input) { calls.push(["rename", input]); return { id: input.passkeyId }; },
    async revokePasskey(input) { calls.push(["revoke", input]); return { id: input.passkeyId }; },
    async listPasskeys(input) { calls.push(["list", input]); return []; },
  });
  const request = { authUser: { id: "session-user" }, authSession: { id: "session-id" } };
  await controller.beginRegistration(request, { currentPassword: PASSWORD, userId: "spoofed" });
  await controller.verifyRegistration(request, { response: { clientDataJSON: "payload", userId: "spoofed" } });
  await controller.rename(request, "passkey-1", { displayName: "My key", userId: "spoofed" });
  await controller.revoke(request, "passkey-1", { currentPassword: PASSWORD, userId: "spoofed" });
  await controller.list(request);
  assert.deepEqual(calls[0], ["begin", { userId: "session-user", identitySessionId: "session-id", currentPassword: PASSWORD }]);
  assert.deepEqual(calls[1], ["verify", { userId: "session-user", identitySessionId: "session-id", registrationResponse: { clientDataJSON: "payload", userId: "spoofed" } }]);
  assert.deepEqual(calls[2], ["rename", { userId: "session-user", identitySessionId: "session-id", passkeyId: "passkey-1", displayName: "My key" }]);
  assert.deepEqual(calls[3], ["revoke", { userId: "session-user", identitySessionId: "session-id", passkeyId: "passkey-1", currentPassword: PASSWORD }]);
  assert.deepEqual(calls[4], ["list", "session-user"]);
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, PasskeyController), true);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, PasskeyController), undefined);
});

test("passkey controller keeps re-authentication failure generic", async () => {
  const controller = new PasskeyController({
    async beginRegistration() { throw new AuthInvalidCredentialsError("raw credential detail"); },
  });
  await assert.rejects(
    () => controller.beginRegistration({ authUser: { id: "user" }, authSession: { id: "session" } }, { currentPassword: PASSWORD }),
    (error) => error instanceof UnauthorizedException && error.message === "Invalid credentials.",
  );
});
