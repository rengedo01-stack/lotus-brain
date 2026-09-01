import assert from "node:assert/strict";
import test from "node:test";
import { passkeyPaths } from "../lib/passkey-management.ts";
import { passkeyMfaOptionsPath } from "../lib/passkey-mfa.ts";
import {
  isWebAuthnAuthenticationOptions,
  isWebAuthnRegistrationOptions,
  requestWebAuthnAuthenticationOptions,
  requestWebAuthnRegistrationOptions,
} from "../lib/webauthn-options.ts";

const registrationOptions = {
  challenge: "registration_challenge-123",
  rp: { id: "localhost", name: "Lotus BRAIN" },
  user: { id: "dXNlci0x", name: "staff@example.test", displayName: "Staff" },
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  timeout: 300_000,
  excludeCredentials: [{ id: "Y3JlZGVudGlhbC0x", type: "public-key", transports: ["internal"] }],
  authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  attestation: "none",
  extensions: { credProps: true, futureExtension: { protocolVersion: 2 } },
  futureBrowserOption: { enabled: true },
};

const authenticationOptions = {
  challenge: "authentication_challenge-123",
  rpId: "localhost",
  allowCredentials: [{ id: "Y3JlZGVudGlhbC0x", type: "public-key", transports: ["internal", "future-transport"] }],
  timeout: 300_000,
  userVerification: "required",
  extensions: { futureExtension: { protocolVersion: 2 } },
  futureBrowserOption: { enabled: true },
};

test("registration options validate critical fields while preserving unknown WebAuthn extensions", () => {
  assert.equal(isWebAuthnRegistrationOptions(registrationOptions), true);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, challenge: "" }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, challenge: 42 }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, rp: { name: "Lotus BRAIN" } }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, user: { ...registrationOptions.user, id: "not/base64" } }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, pubKeyCredParams: [] }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, timeout: -1 }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, excludeCredentials: [{ id: "id", type: "public-key" }, { id: "id", type: "public-key" }] }), false);
  assert.equal(isWebAuthnRegistrationOptions({ ...registrationOptions, extensions: { credProps: "true" } }), false);
});

test("authentication options validate the user-bound MFA boundary without rejecting future fields", () => {
  assert.equal(isWebAuthnAuthenticationOptions(authenticationOptions), true);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, challenge: "" }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, rpId: "" }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, allowCredentials: [] }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, allowCredentials: [{ id: "credential", type: "other" }] }), false);
  assert.equal(isWebAuthnAuthenticationOptions({
    ...authenticationOptions,
    allowCredentials: [
      { id: "Y3JlZGVudGlhbC0x", type: "public-key" },
      { id: "Y3JlZGVudGlhbC0x", type: "public-key" },
    ],
  }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, timeout: 1.5 }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, userVerification: "invalid" }), false);
  assert.equal(isWebAuthnAuthenticationOptions({ ...authenticationOptions, extensions: [] }), false);
});

test("registration options use exact HTTP 200 and call WebAuthn only after validation", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      return registrationOptions as T;
    },
  };
  let startCalls = 0;
  let received: unknown;
  const options = await requestWebAuthnRegistrationOptions(api, passkeyPaths.registrationOptions, "current password");
  await (async (value: unknown) => { startCalls += 1; received = value; })(options);

  assert.equal(startCalls, 1);
  assert.strictEqual(received, registrationOptions);
  assert.deepEqual(calls, [{
    path: passkeyPaths.registrationOptions,
    options: { method: "POST", body: { currentPassword: "current password" }, expectedStatus: 200 },
  }]);
});

for (const [label, response] of [
  ["malformed JSON", new SyntaxError("Unexpected end of JSON input")],
  ["missing challenge", { ...registrationOptions, challenge: undefined }],
  ["malformed required nested object", { ...registrationOptions, rp: { id: "localhost" } }],
  ["malformed known optional field", { ...registrationOptions, timeout: "300000" }],
] as const) {
  test(`registration options ${label} never invoke WebAuthn`, async () => {
    const api = {
      async request<T>(): Promise<T> {
        if (response instanceof Error) throw response;
        return response as T;
      },
    };
    let startCalls = 0;
    await assert.rejects(async () => {
      const options = await requestWebAuthnRegistrationOptions(api, passkeyPaths.registrationOptions, "current password");
      startCalls += 1;
      void options;
    });
    assert.equal(startCalls, 0);
  });
}

for (const status of [201, 202, 204]) {
  test(`registration options unexpected ${status} never invoke WebAuthn`, async () => {
    const api = { async request<T>(): Promise<T> { throw Object.assign(new Error("Unexpected status"), { status }); } };
    let startCalls = 0;
    await assert.rejects(async () => {
      const options = await requestWebAuthnRegistrationOptions(api, passkeyPaths.registrationOptions, "current password");
      startCalls += 1;
      void options;
    });
    assert.equal(startCalls, 0);
  });
}

for (const action of ["enable", "disable"] as const) {
  test(`MFA ${action} options use exact HTTP 200 and preserve compatible unknown fields`, async () => {
    const calls: Array<{ path: string; options: unknown }> = [];
    const api = {
      async request<T>(path: string, options: unknown): Promise<T> {
        calls.push({ path, options });
        return authenticationOptions as T;
      },
    };
    let startCalls = 0;
    let received: unknown;
    const options = await requestWebAuthnAuthenticationOptions(api, passkeyMfaOptionsPath(action), "current password");
    await (async (value: unknown) => { startCalls += 1; received = value; })(options);

    assert.equal(startCalls, 1);
    assert.strictEqual(received, authenticationOptions);
    assert.deepEqual(calls, [{
      path: passkeyMfaOptionsPath(action),
      options: { method: "POST", body: { currentPassword: "current password" }, expectedStatus: 200 },
    }]);
  });
}

for (const action of ["enable", "disable"] as const) {
  for (const [label, response] of [
    ["malformed JSON", new SyntaxError("Unexpected end of JSON input")],
    ["missing challenge", { ...authenticationOptions, challenge: undefined }],
    ["empty challenge", { ...authenticationOptions, challenge: "" }],
    ["wrong challenge type", { ...authenticationOptions, challenge: 42 }],
    ["malformed credential descriptor", { ...authenticationOptions, allowCredentials: [{ id: "id", type: "other" }] }],
    ["malformed known optional field", { ...authenticationOptions, userVerification: false }],
  ] as const) {
    test(`MFA ${action} options ${label} never invoke WebAuthn`, async () => {
      const api = {
        async request<T>(): Promise<T> {
          if (response instanceof Error) throw response;
          return response as T;
        },
      };
      let startCalls = 0;
      await assert.rejects(async () => {
        const options = await requestWebAuthnAuthenticationOptions(api, passkeyMfaOptionsPath(action), "current password");
        startCalls += 1;
        void options;
      });
      assert.equal(startCalls, 0);
    });
  }

  for (const status of [201, 202, 204]) {
    test(`MFA ${action} options unexpected ${status} never invoke WebAuthn`, async () => {
      const api = { async request<T>(): Promise<T> { throw Object.assign(new Error("Unexpected status"), { status }); } };
      let startCalls = 0;
      await assert.rejects(async () => {
        const options = await requestWebAuthnAuthenticationOptions(api, passkeyMfaOptionsPath(action), "current password");
        startCalls += 1;
        void options;
      });
      assert.equal(startCalls, 0);
    });
  }
}
