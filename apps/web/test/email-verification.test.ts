import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmailVerificationConfirmed,
  emailVerificationRequestPath,
  isEmailVerificationRequestAccepted,
} from "../lib/email-verification.ts";

test("email verification request keeps the authenticated self-service endpoint", () => {
  assert.equal(emailVerificationRequestPath, "/auth/email/verification/request");
});

test("email verification accepts only the documented exact confirmation response", () => {
  assert.equal(isEmailVerificationConfirmed({ status: "verified" }), true);
  assert.equal(isEmailVerificationConfirmed({ status: "ok" }), false);
  assert.equal(isEmailVerificationConfirmed({ status: "verified", email: "operator@example.test" }), false);
  assert.equal(isEmailVerificationConfirmed(null), false);
});

test("email verification request accepts only the documented generic success response", () => {
  assert.equal(isEmailVerificationRequestAccepted({ status: "accepted" }), true);
  assert.equal(isEmailVerificationRequestAccepted({ status: "ok" }), false);
  assert.equal(isEmailVerificationRequestAccepted(null), false);
});
