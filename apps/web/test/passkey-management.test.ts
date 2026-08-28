import assert from "node:assert/strict";
import test from "node:test";
import {
  addPasskeyFromResponse,
  isCurrentPasskeyListResponse,
  isPasskeyList,
  isPasskeyMutationResponse,
  passkeyPaths,
  passkeyRenamePath,
  passkeyRevokePath,
  replacePasskeyFromResponse,
  type PasskeyView,
} from "../lib/passkey-management.ts";

function passkey(overrides: Partial<PasskeyView> = {}): PasskeyView {
  return {
    backedUp: true,
    createdAt: "2026-08-28T00:00:00.000Z",
    deviceType: "singleDevice",
    displayName: "Office key",
    id: "passkey-1",
    lastUsedAt: null,
    revokedAt: null,
    transports: ["internal"],
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

test("passkey management stays within the authenticated API contract", () => {
  assert.equal(passkeyPaths.list, "/auth/passkeys");
  assert.equal(passkeyPaths.registrationOptions, "/auth/passkeys/registration/options");
  assert.equal(passkeyPaths.registrationVerify, "/auth/passkeys/registration/verify");
  assert.equal(passkeyRenamePath("passkey/a"), "/auth/passkeys/passkey%2Fa");
  assert.equal(passkeyRevokePath("passkey/a"), "/auth/passkeys/passkey%2Fa/revoke");
});

test("passkey management accepts only safe documented views", () => {
  assert.equal(isPasskeyList([passkey()]), true);
  assert.equal(isPasskeyList([{ ...passkey(), transports: ["internal", 1] }]), false);
  assert.equal(isPasskeyMutationResponse({ passkey: passkey() }), true);
  assert.equal(isPasskeyMutationResponse({ passkey: { id: "passkey-1" } }), false);
});

test("successful passkey mutations update only the response-backed local state", () => {
  const first = passkey({ id: "first", createdAt: "2026-08-28T00:00:00.000Z" });
  const second = passkey({ id: "second", createdAt: "2026-08-28T00:01:00.000Z" });
  assert.deepEqual(addPasskeyFromResponse([second], first).map((item) => item.id), ["first", "second"]);
  assert.deepEqual(
    replacePasskeyFromResponse([first], passkey({ id: "first", displayName: "Renamed key" })),
    [passkey({ id: "first", displayName: "Renamed key" })],
  );
});

test("an older passkey list response cannot overwrite a successful mutation", () => {
  assert.equal(isCurrentPasskeyListResponse(2, 2), true);
  assert.equal(isCurrentPasskeyListResponse(2, 3), false);
});
