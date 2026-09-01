import assert from "node:assert/strict";
import test from "node:test";
import {
  isPasskeyAuthenticationOptions,
  isPasskeyMfaMutationResponse,
  isPasskeyMfaStatus,
  passkeyMfaErrorMessage,
  passkeyMfaOptionsPath,
  passkeyMfaPaths,
  passkeyMfaVerifyPath,
  requestPasskeyMfaStatus,
} from "../lib/passkey-mfa.ts";

test("passkey MFA settings use only the documented authenticated API endpoints", () => {
  assert.equal(passkeyMfaPaths.status, "/auth/mfa/passkey");
  assert.equal(passkeyMfaOptionsPath("enable"), "/auth/mfa/passkey/enable/options");
  assert.equal(passkeyMfaVerifyPath("enable"), "/auth/mfa/passkey/enable/verify");
  assert.equal(passkeyMfaOptionsPath("disable"), "/auth/mfa/passkey/disable/options");
  assert.equal(passkeyMfaVerifyPath("disable"), "/auth/mfa/passkey/disable/verify");
});

test("passkey MFA settings accept only documented status and mutation responses", () => {
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: 1, recoveryEmailVerified: true }), true);
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: 1, recoveryEmailVerified: true, extra: "unexpected" }), false);
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: 1 }), false);
  assert.equal(isPasskeyMfaStatus({ enabled: "false", activePasskeyCount: 1, recoveryEmailVerified: true }), false);
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: -1, recoveryEmailVerified: true }), false);
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: 1.5, recoveryEmailVerified: true }), false);
  assert.equal(isPasskeyMfaMutationResponse({ status: "ok" }), true);
  assert.equal(isPasskeyMfaMutationResponse({ status: "updated" }), false);
  assert.equal(isPasskeyMfaMutationResponse({ status: "ok", session: "not-used" }), false);
  assert.equal(isPasskeyMfaMutationResponse(null), false);
});

test("MFA status requires the exact HTTP 200 and exact JSON contract", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      return { enabled: false, activePasskeyCount: 1, recoveryEmailVerified: true } as T;
    },
  };
  await requestPasskeyMfaStatus(api);
  assert.deepEqual(calls, [{ path: passkeyMfaPaths.status, options: { expectedStatus: 200 } }]);

  for (const status of [201, 202, 204]) {
    const unexpectedStatusApi = {
      async request<T>(): Promise<T> {
        throw Object.assign(new Error("Unexpected success status"), { status });
      },
    };
    await assert.rejects(() => requestPasskeyMfaStatus(unexpectedStatusApi));
  }

  for (const malformed of [
    null,
    { enabled: false, activePasskeyCount: 1, recoveryEmailVerified: true, extra: true },
    { enabled: false, activePasskeyCount: -1, recoveryEmailVerified: true },
  ]) {
    const malformedApi = { async request<T>(): Promise<T> { return malformed as T; } };
    await assert.rejects(() => requestPasskeyMfaStatus(malformedApi));
  }
});

test("passkey MFA settings require a usable assertion challenge before invoking WebAuthn", () => {
  const options = {
    challenge: "opaque-challenge",
    rpId: "localhost",
    allowCredentials: [{ id: "credential-1", type: "public-key", transports: ["internal"] }],
  };
  assert.equal(isPasskeyAuthenticationOptions(options), true);
  assert.equal(isPasskeyAuthenticationOptions({ ...options, challenge: "" }), false);
  assert.equal(isPasskeyAuthenticationOptions({ ...options, allowCredentials: [] }), false);
  assert.equal(isPasskeyAuthenticationOptions({}), false);
});

test("passkey MFA settings stop safely on conflicts without exposing server detail", () => {
  assert.equal(
    passkeyMfaErrorMessage({ kind: "conflict", message: "raw database conflict detail" }),
    "MFAの状態が更新されています。ページを再読み込みしてから再試行してください。",
  );
  assert.equal(
    passkeyMfaErrorMessage({ kind: "forbidden" }),
    "この操作は許可されていません。ログイン状態を確認してください。",
  );
});
