const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { UnauthorizedException } = require("@nestjs/common");

const { LoginUseCase } = require("../dist/modules/auth/application/auth.use-cases.js");
const { AuthInvalidCredentialsError } = require("../dist/modules/auth/auth.errors.js");
const {
  PasskeyMfaCeremonyInvalidError,
  PasskeyMfaService,
} = require("../dist/modules/auth/application/passkey-mfa.service.js");
const { PasskeyCeremonyInvalidError } = require("../dist/modules/auth/application/passkey-enrollment.errors.js");
const { SessionAuthGuard } = require("../dist/modules/auth/guards/session-auth.guard.js");
const { PASSKEY_MFA_REPOSITORY } = require("../dist/modules/auth/application/passkey-mfa.repository.js");
const { PASSKEY_WEBAUTHN_ADAPTER } = require("../dist/modules/auth/application/passkey-webauthn.adapter.js");
const { PasskeyMfaController, PasskeyMfaLoginController } = require("../dist/modules/auth/presentation/passkey-mfa.controller.js");
const { SimpleWebAuthnPasskeyAdapter } = require("../dist/modules/auth/infrastructure/simplewebauthn-passkey.adapter.js");
const { AUTHENTICATED_ONLY_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { AUTH_PUBLIC_KEY } = require("../dist/modules/auth/auth.constants.js");

const PASSWORD = "mfa password is sufficiently long";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function coseP256PublicKey(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
}

function signedAssertion({ challenge, credentialId, flags = 0x05, origin = "http://localhost:3000", privateKey, rpId = "localhost", userId = "user-1" }) {
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: "webauthn.get",
    challenge: base64Url(challenge),
    origin,
    crossOrigin: false,
  }));
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([flags]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const payload = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    response: {
      clientDataJSON: base64Url(clientDataJSON),
      authenticatorData: base64Url(authenticatorData),
      signature: base64Url(sign("sha256", payload, privateKey)),
      userHandle: base64Url(userId),
    },
    clientExtensionResults: {},
  };
}

function config() {
  return {
    get(key) {
      return {
        NODE_ENV: "development",
        CORS_ORIGIN: "http://localhost:3000",
        WEBAUTHN_RP_ID: "localhost",
        WEBAUTHN_ORIGIN: "http://localhost:3000",
      }[key];
    },
  };
}

function activeUser(overrides = {}) {
  return {
    id: "user-1",
    email: "mfa@example.test",
    displayName: "MFA User",
    status: "ACTIVE",
    deletedAt: null,
    credentialVersion: 4,
    authenticationPolicyVersion: 9,
    passkeyMfaEnabledAt: new Date("2026-08-14T00:00:00.000Z"),
    lastLoginAt: null,
    createdAt: new Date("2026-08-14T00:00:00.000Z"),
    updatedAt: new Date("2026-08-14T00:00:00.000Z"),
    ...overrides,
  };
}

test("MFA-enabled password login creates no IdentitySession and exposes MFA_REQUIRED only after valid password", async () => {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  let sessionCreates = 0;
  const mfaCalls = [];
  const repository = {
    async findUserByEmail() { return { ...activeUser(), passwordHash }; },
    async createSessionAndMarkUserLogin() { sessionCreates += 1; },
  };
  const mfa = {
    async beginMfaLogin(input) {
      mfaCalls.push(input);
      return { options: { challenge: "opaque-challenge" }, preAuthToken: "pre-auth", preAuthCsrfToken: "pre-auth-csrf" };
    },
  };
  const login = new LoginUseCase(repository, mfa);
  const result = await login.execute({ email: "mfa@example.test", password: PASSWORD });
  assert.equal(result.status, "MFA_REQUIRED");
  assert.equal(result.preAuthToken, "pre-auth");
  assert.equal(sessionCreates, 0);
  assert.deepEqual(mfaCalls, [{ userId: "user-1", credentialVersion: 4, authenticationPolicyVersion: 9 }]);

  await assert.rejects(
    () => login.execute({ email: "mfa@example.test", password: "wrong password" }),
    (error) => error instanceof AuthInvalidCredentialsError && error.message === "Invalid email or password.",
  );
  assert.equal(mfaCalls.length, 1);
  assert.equal(sessionCreates, 0);
});

test("MFA login verification requires the pre-auth cookie, pre-auth CSRF, exact challenge, and produces fresh full-session secrets", async () => {
  const calls = [];
  const repository = {
    async claimMfaLogin(input) {
      calls.push(["claim", input]);
      return {
        ceremonyId: "transaction-1",
        userId: "user-1",
        credential: { id: "credential-row", credentialId: "credential-id", publicKey: Uint8Array.from([1]), counter: 0n, transports: ["internal"] },
      };
    },
    async completeMfaLogin(input) {
      calls.push(["complete", input]);
      return activeUser({ passkeyMfaEnabledAt: new Date() });
    },
  };
  const webAuthn = {
    extractAuthenticationChallenge() { return "a".repeat(43); },
    extractAuthenticationCredentialId() { return "credential-id"; },
    async verifyAuthenticationResponse(input) {
      calls.push(["verify", input]);
      return { credentialId: "credential-id", newCounter: 0n };
    },
  };
  const service = new PasskeyMfaService(repository, webAuthn, config());
  const result = await service.verifyMfaLogin({
    assertionResponse: { response: {} },
    preAuthToken: "raw-pre-auth-token",
    preAuthCsrfToken: "raw-pre-auth-csrf",
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
  });
  const claim = calls.find(([kind]) => kind === "claim")[1];
  const completion = calls.find(([kind]) => kind === "complete")[1];
  assert.match(claim.transactionTokenHash, /^[a-f0-9]{64}$/);
  assert.match(claim.csrfTokenHash, /^[a-f0-9]{64}$/);
  assert.match(claim.challengeHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.values(claim).includes("raw-pre-auth-token"), false);
  assert.equal(Object.values(claim).includes("raw-pre-auth-csrf"), false);
  assert.notEqual(result.sessionToken, "raw-pre-auth-token");
  assert.notEqual(result.csrfToken, "raw-pre-auth-csrf");
  assert.match(completion.sessionTokenHash, /^[a-f0-9]{64}$/);
  assert.match(completion.sessionCsrfTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(completion.credentialId, "credential-row");
});

test("invalid or cross-credential assertion never completes an MFA login", async () => {
  let completed = false;
  const repository = {
    async claimMfaLogin() {
      return {
        ceremonyId: "transaction-1",
        userId: "user-1",
        credential: { id: "credential-row", credentialId: "credential-id", publicKey: Uint8Array.from([1]), counter: 0n, transports: [] },
      };
    },
    async completeMfaLogin() { completed = true; },
  };
  const service = new PasskeyMfaService(repository, {
    extractAuthenticationChallenge() { return "b".repeat(43); },
    extractAuthenticationCredentialId() { return "credential-id"; },
    async verifyAuthenticationResponse() { return { credentialId: "other-credential", newCounter: 0n }; },
  }, config());
  await assert.rejects(
    () => service.verifyMfaLogin({ assertionResponse: {}, preAuthToken: "x", preAuthCsrfToken: "y", ipAddress: null, userAgent: null }),
    PasskeyMfaCeremonyInvalidError,
  );
  assert.equal(completed, false);
});

test("SessionAuthGuard rejects stale authentication policy versions and prevents zombie-session resurrection", async () => {
  const session = {
    id: "session-1",
    userId: "user-1",
    credentialVersion: 4,
    authenticationPolicyVersion: 8,
    csrfTokenHash: "csrf",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    lastSeenAt: null,
    user: activeUser({ authenticationPolicyVersion: 9, passkeyMfaEnabledAt: null }),
  };
  const guard = new SessionAuthGuard(
    { getAllAndOverride() { return false; } },
    { async findSessionByTokenHash() { return session; }, async touchSession() {} },
    config(),
  );
  const context = {
    getClass() { return class TestController {}; },
    getHandler() { return function testHandler() {}; },
    switchToHttp() { return { getRequest() { return { url: "/api/v1/auth/me", cookies: { lotus_session: "raw" } }; } }; },
  };
  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

test("MFA controllers have explicit authenticated and public boundaries without accepting request-body identity", () => {
  assert.equal(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, PasskeyMfaController), true);
  assert.equal(Reflect.getMetadata(AUTH_PUBLIC_KEY, PasskeyMfaLoginController.prototype.verifyLogin), true);
  assert.equal(PASSKEY_MFA_REPOSITORY.description, "PASSKEY_MFA_REPOSITORY");
  assert.equal(PASSKEY_WEBAUTHN_ADAPTER.description, "PASSKEY_WEBAUTHN_ADAPTER");
});

test("server-side passkey MFA verification requires the exact challenge, origin, RP ID, UP, and UV", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const adapter = new SimpleWebAuthnPasskeyAdapter();
  const challenge = "a".repeat(43);
  const credentialId = base64Url(Buffer.from("credential-id-123"));
  const credential = {
    id: "credential-row",
    credentialId,
    publicKey: coseP256PublicKey(publicKey),
    counter: 0n,
    transports: ["internal"],
  };
  const valid = signedAssertion({ challenge, credentialId, privateKey });
  const input = {
    assertionResponse: valid,
    credential,
    expectedChallenge: challenge,
    expectedOrigin: "http://localhost:3000",
    expectedRpId: "localhost",
    expectedUserId: "user-1",
  };
  const verified = await adapter.verifyAuthenticationResponse(input);
  assert.equal(verified.credentialId, credentialId);
  assert.equal(verified.newCounter, 1n);

  await assert.rejects(
    () => adapter.verifyAuthenticationResponse({ ...input, expectedChallenge: "b".repeat(43) }),
    PasskeyCeremonyInvalidError,
  );
  await assert.rejects(
    () => adapter.verifyAuthenticationResponse({
      ...input,
      assertionResponse: signedAssertion({ challenge, credentialId, privateKey, origin: "https://attacker.example.test" }),
    }),
    PasskeyCeremonyInvalidError,
  );
  await assert.rejects(
    () => adapter.verifyAuthenticationResponse({
      ...input,
      assertionResponse: signedAssertion({ challenge, credentialId, privateKey, rpId: "attacker.example.test" }),
    }),
    PasskeyCeremonyInvalidError,
  );
  await assert.rejects(
    () => adapter.verifyAuthenticationResponse({
      ...input,
      assertionResponse: signedAssertion({ challenge, credentialId, privateKey, flags: 0x01 }),
    }),
    PasskeyCeremonyInvalidError,
  );
  await assert.rejects(
    () => adapter.verifyAuthenticationResponse({
      ...input,
      assertionResponse: signedAssertion({ challenge, credentialId, privateKey, flags: 0x04 }),
    }),
    PasskeyCeremonyInvalidError,
  );
});

test("the shared UP/UV policy prevents MFA login, enablement, and disablement side effects", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const adapter = new SimpleWebAuthnPasskeyAdapter();
  const challenge = "c".repeat(43);
  const credentialId = base64Url(Buffer.from("credential-id-side-effects"));
  const credential = {
    id: "credential-row",
    credentialId,
    publicKey: coseP256PublicKey(publicKey),
    counter: 0n,
    transports: ["internal"],
  };
  const assertionWithoutUp = signedAssertion({ challenge, credentialId, privateKey, flags: 0x04 });

  let loginCompletions = 0;
  const loginService = new PasskeyMfaService({
    async claimMfaLogin() { return { ceremonyId: "login-ceremony", credential, userId: "user-1" }; },
    async completeMfaLogin() { loginCompletions += 1; },
  }, adapter, config());
  await assert.rejects(
    () => loginService.verifyMfaLogin({
      assertionResponse: assertionWithoutUp,
      preAuthToken: "pre-auth-token",
      preAuthCsrfToken: "pre-auth-csrf",
      ipAddress: null,
      userAgent: null,
    }),
    PasskeyCeremonyInvalidError,
  );
  assert.equal(loginCompletions, 0);

  for (const [purpose, invoke] of [
    ["ENABLE_MFA", (service) => service.verifyEnable({ userId: "user-1", identitySessionId: "session-1", response: assertionWithoutUp })],
    ["DISABLE_MFA", (service) => service.verifyDisable({ userId: "user-1", identitySessionId: "session-1", response: assertionWithoutUp })],
  ]) {
    let stepUpCompletions = 0;
    const stepUpService = new PasskeyMfaService({
      async claimStepUp() { return { ceremonyId: `${purpose}-ceremony`, credential, userId: "user-1" }; },
      async completeStepUp() { stepUpCompletions += 1; },
    }, adapter, config());
    await assert.rejects(() => invoke(stepUpService), PasskeyCeremonyInvalidError);
    assert.equal(stepUpCompletions, 0);
  }
});
