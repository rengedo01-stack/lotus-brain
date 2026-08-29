import assert from "node:assert/strict";
import test from "node:test";
import {
  isPasswordChangeAccepted,
  passwordChangePath,
  passwordChangePayload,
} from "../lib/password-change.ts";

test("password change accepts only the documented success response", () => {
  assert.equal(isPasswordChangeAccepted({ status: "ok" }), true);
  assert.equal(isPasswordChangeAccepted({ status: "accepted" }), false);
  assert.equal(isPasswordChangeAccepted({ status: "ok", user: { id: "not-used" } }), false);
  assert.equal(isPasswordChangeAccepted({ status: "ok", csrfToken: "not-used" }), false);
  assert.equal(isPasswordChangeAccepted(null), false);
});

test("password change keeps the protected endpoint and submits matching passwords without transforming them", () => {
  assert.equal(passwordChangePath, "/auth/password/change");
  assert.deepEqual(
    passwordChangePayload(" current password ", " New password value ", " New password value "),
    { currentPassword: " current password ", newPassword: " New password value " },
  );
  assert.equal(passwordChangePayload("", "new password", "new password"), null);
  assert.equal(passwordChangePayload("current password", "", ""), null);
  assert.equal(passwordChangePayload("current password", "new password", "different password"), null);
});
