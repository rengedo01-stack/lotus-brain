import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedIdentityStatusTransitions,
  identityUserListPath,
  isIdentityUser,
  isIdentityUserList,
  replaceIdentityUser,
} from "../lib/identity.ts";

const user = {
  id: "user-1",
  email: "operator@example.test",
  status: "ACTIVE" as const,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  lastLoginAt: null,
  deletedAt: null,
};

test("identity response guards accept only the documented user-directory response shape", () => {
  assert.equal(isIdentityUser(user), true);
  assert.equal(isIdentityUser({ ...user, status: "PENDING" }), false);
  assert.equal(isIdentityUser({ ...user, deletedAt: 0 }), false);
  assert.equal(isIdentityUserList([user]), true);
  assert.equal(isIdentityUserList([{ ...user, email: null }]), false);
});

test("identity directory request stays inside the list API contract", () => {
  assert.equal(
    identityUserListPath({ email: " user@example.test ", status: "DISABLED", deleted: "not_deleted" }),
    "/identity/users?limit=100&offset=0&email=user%40example.test&status=DISABLED&deleted=false",
  );
  assert.equal(
    identityUserListPath({ email: "", status: "", deleted: "deleted" }),
    "/identity/users?limit=100&offset=0&deleted=true",
  );
});

test("only documented lifecycle transitions are offered and deleted users have no UI mutation", () => {
  assert.deepEqual(allowedIdentityStatusTransitions(user), ["DISABLED", "LOCKED"]);
  assert.deepEqual(allowedIdentityStatusTransitions({ ...user, status: "DISABLED" }), ["ACTIVE"]);
  assert.deepEqual(allowedIdentityStatusTransitions({ ...user, status: "LOCKED" }), ["ACTIVE"]);
  assert.deepEqual(allowedIdentityStatusTransitions({ ...user, deletedAt: "2026-08-26T01:00:00.000Z" }), []);
});

test("successful lifecycle mutations replace UI state from the server response without a follow-up read", () => {
  const updated = { ...user, status: "DISABLED" as const, updatedAt: "2026-08-26T01:00:00.000Z" };
  assert.deepEqual(replaceIdentityUser([user], updated), [updated]);
});
