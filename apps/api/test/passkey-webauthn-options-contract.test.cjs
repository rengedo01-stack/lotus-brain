const test = require("node:test");
const assert = require("node:assert/strict");

const { SimpleWebAuthnPasskeyAdapter } = require("../dist/modules/auth/infrastructure/simplewebauthn-passkey.adapter.js");
const {
  passkeyAuthenticationOptionsResponseSchema,
  passkeyRegistrationOptionsResponseSchema,
} = require("../dist/modules/auth/presentation/passkey-response.schemas.js");

const challenge = "D8K7NJcLBznJTGGkdhXuaf79OxBDmDJu4xfiLsJdYqc";

function assertBase64Url(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^[A-Za-z0-9_-]+$/);
  assert.ok(value.length > 0);
}

test("SimpleWebAuthn registration options expose the documented critical fields while allowing standard extensions", async () => {
  const adapter = new SimpleWebAuthnPasskeyAdapter();
  const options = await adapter.generateRegistrationOptions({
    context: {
      email: "passkey-options@example.test",
      displayName: "Passkey options",
      activeCredentials: [{ credentialId: "Y3JlZGVudGlhbC0x", transports: ["internal"] }],
    },
    challenge,
    rpId: "localhost",
    rpName: "Lotus BRAIN",
    userId: "user-options-1",
  });

  assertBase64Url(options.challenge);
  assert.deepEqual(options.rp, { id: "localhost", name: "Lotus BRAIN" });
  assertBase64Url(options.user.id);
  assert.equal(options.user.name, "passkey-options@example.test");
  assert.equal(options.user.displayName, "Passkey options");
  assert.ok(Array.isArray(options.pubKeyCredParams) && options.pubKeyCredParams.length > 0);
  assert.ok(options.pubKeyCredParams.every((item) => item.type === "public-key" && Number.isInteger(item.alg)));
  assert.equal(options.timeout, 300_000);
  assert.equal(options.authenticatorSelection.userVerification, "required");
  assert.equal(options.attestation, "none");
  assert.deepEqual(options.excludeCredentials, [{ id: "Y3JlZGVudGlhbC0x", transports: ["internal"], type: "public-key" }]);
  assert.deepEqual(options.extensions, { credProps: true });
  assert.equal(passkeyRegistrationOptionsResponseSchema.additionalProperties, true);
  assert.deepEqual(passkeyRegistrationOptionsResponseSchema.required, ["challenge", "rp", "user", "pubKeyCredParams"]);
});

test("SimpleWebAuthn MFA authentication options expose a user-bound descriptor list and open extension surface", async () => {
  const adapter = new SimpleWebAuthnPasskeyAdapter();
  const options = await adapter.generateAuthenticationOptions({
    activeCredentials: [{ credentialId: "Y3JlZGVudGlhbC0x", transports: ["internal"] }],
    challenge,
    rpId: "localhost",
  });

  assertBase64Url(options.challenge);
  assert.equal(options.rpId, "localhost");
  assert.equal(options.timeout, 300_000);
  assert.equal(options.userVerification, "required");
  assert.deepEqual(options.allowCredentials, [{ id: "Y3JlZGVudGlhbC0x", transports: ["internal"], type: "public-key" }]);
  assert.equal(passkeyAuthenticationOptionsResponseSchema.additionalProperties, true);
  assert.deepEqual(passkeyAuthenticationOptionsResponseSchema.required, ["challenge", "rpId", "allowCredentials"]);
});
