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
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: -1, recoveryEmailVerified: true }), false);
  assert.equal(isPasskeyMfaStatus({ enabled: false, activePasskeyCount: 1.5, recoveryEmailVerified: true }), false);
  assert.equal(isPasskeyMfaMutationResponse({ status: "ok" }), true);
  assert.equal(isPasskeyMfaMutationResponse({ status: "updated" }), false);
  assert.equal(isPasskeyMfaMutationResponse({ status: "ok", session: "not-used" }), false);
  assert.equal(isPasskeyMfaMutationResponse(null), false);
});

test("passkey MFA settings require a usable assertion challenge before invoking WebAuthn", () => {
  assert.equal(isPasskeyAuthenticationOptions({ challenge: "opaque-challenge" }), true);
  assert.equal(isPasskeyAuthenticationOptions({ challenge: "" }), false);
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
