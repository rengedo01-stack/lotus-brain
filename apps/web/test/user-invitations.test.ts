import assert from "node:assert/strict";
import test from "node:test";
import {
  insertUserInvitation,
  isUserInvitation,
  isUserInvitationList,
  isUserInvitationResendAccepted,
  replaceUserInvitation,
  userInvitationListPath,
} from "../lib/user-invitations.ts";

const invitation = {
  id: "invitation-2",
  email: "operator@example.test",
  status: "PENDING" as const,
  createdAt: "2026-08-27T00:00:00.000Z",
  acceptedAt: null,
  cancelledAt: null,
};

test("invitation response guards accept only the documented administrative shape", () => {
  assert.equal(isUserInvitation(invitation), true);
  assert.equal(isUserInvitation({ ...invitation, status: "SENT" }), false);
  assert.equal(isUserInvitation({ ...invitation, acceptedAt: 0 }), false);
  assert.equal(isUserInvitationList([invitation]), true);
  assert.equal(isUserInvitationList([{ ...invitation, email: null }]), false);
  assert.equal(isUserInvitationResendAccepted({ status: "accepted" }), true);
  assert.equal(isUserInvitationResendAccepted({ status: "ok" }), false);
});

test("invitation directory request remains within the existing API contract", () => {
  assert.equal(userInvitationListPath({ status: "PENDING" }), "/identity/invitations?limit=100&offset=0&status=PENDING");
  assert.equal(userInvitationListPath({ status: "" }), "/identity/invitations?limit=100&offset=0");
});

test("create response is inserted in the server's deterministic order without a follow-up read", () => {
  const older = { ...invitation, id: "invitation-1", createdAt: "2026-08-26T00:00:00.000Z" };
  assert.deepEqual(insertUserInvitation([older], invitation), [invitation, older]);
});

test("cancel response replaces only its authoritative record and resend requires no state read", () => {
  const cancelled = { ...invitation, status: "CANCELLED" as const, cancelledAt: "2026-08-27T01:00:00.000Z" };
  assert.deepEqual(replaceUserInvitation([invitation], cancelled), [cancelled]);
});
