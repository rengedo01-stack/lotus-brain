import assert from "node:assert/strict";
import test from "node:test";
import {
  isPasswordRecoveryResetComplete,
  isPasswordRecoveryRequestAccepted,
  passwordRecoveryRequestPath,
  passwordRecoveryRequestPayload,
} from "../lib/password-recovery.ts";

test("password recovery request accepts only the documented generic success response", () => {
  assert.equal(isPasswordRecoveryRequestAccepted({ status: "accepted" }), true);
  assert.equal(isPasswordRecoveryRequestAccepted({ status: "ok" }), false);
  assert.equal(isPasswordRecoveryRequestAccepted({ status: "accepted", email: "operator@example.test" }), false);
  assert.equal(isPasswordRecoveryRequestAccepted(null), false);
});

test("password recovery reset accepts only the documented exact completion response", () => {
  assert.equal(isPasswordRecoveryResetComplete({ status: "ok" }), true);
  assert.equal(isPasswordRecoveryResetComplete({ status: "accepted" }), false);
  assert.equal(isPasswordRecoveryResetComplete({ status: "ok", user: { id: "not-used" } }), false);
  assert.equal(isPasswordRecoveryResetComplete(null), false);
});

test("password recovery request keeps the public endpoint and submits a trimmed email only", () => {
  assert.equal(passwordRecoveryRequestPath, "/auth/password/recovery/request");
  assert.deepEqual(passwordRecoveryRequestPayload("  Operator@example.test  "), { email: "Operator@example.test" });
  assert.equal(passwordRecoveryRequestPayload("   "), null);
});
