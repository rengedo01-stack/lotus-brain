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
  requestPasskeyList,
  requestPasskeyMutation,
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

test("passkey management accepts only the exact documented passkey view", () => {
  assert.equal(isPasskeyList([passkey()]), true);
  assert.equal(isPasskeyList([{ ...passkey(), unexpected: "not-accepted" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), id: "" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), transports: ["internal", 1] }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), transports: ["unknown-transport"] }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), deviceType: "unknown-device" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), createdAt: "2026-08-28" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), lastUsedAt: "not-a-date" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), backedUp: "true" }]), false);
  assert.equal(isPasskeyList([{ ...passkey(), displayName: undefined }]), false);
  assert.equal(isPasskeyList([passkey(), passkey()]), false);
  assert.equal(isPasskeyMutationResponse({ passkey: passkey() }), true);
  assert.equal(isPasskeyMutationResponse({ passkey: passkey(), extra: true }), false);
  assert.equal(isPasskeyMutationResponse({ passkey: { id: "passkey-1" } }), false);
  assert.equal(isPasskeyMutationResponse(null), false);
});

test("passkey list and mutation requests require exact HTTP 200 before trusting JSON", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      if (path === passkeyPaths.list) return [passkey()] as T;
      return { passkey: passkey({ id: path }) } as T;
    },
  };

  await requestPasskeyList(api);
  await requestPasskeyMutation(api, passkeyPaths.registrationVerify, { method: "POST", body: { response: "registration" } });
  await requestPasskeyMutation(api, passkeyRenamePath("passkey-1"), { method: "PATCH", body: { displayName: "Renamed" } });
  await requestPasskeyMutation(api, passkeyRevokePath("passkey-1"), { method: "POST", body: { currentPassword: "password" } });

  assert.deepEqual(calls, [
    { path: passkeyPaths.list, options: { expectedStatus: 200 } },
    {
      path: passkeyPaths.registrationVerify,
      options: { method: "POST", body: { response: "registration" }, expectedStatus: 200 },
    },
    {
      path: passkeyRenamePath("passkey-1"),
      options: { method: "PATCH", body: { displayName: "Renamed" }, expectedStatus: 200 },
    },
    {
      path: passkeyRevokePath("passkey-1"),
      options: { method: "POST", body: { currentPassword: "password" }, expectedStatus: 200 },
    },
  ]);
});

test("passkey requests leave response-backed state unchanged when HTTP or JSON contracts fail", async () => {
  for (const status of [201, 202, 204]) {
    const api = {
      async request<T>(): Promise<T> {
        throw Object.assign(new Error("Unexpected success status"), { status });
      },
    };
    await assert.rejects(() => requestPasskeyList(api));
    await assert.rejects(() => requestPasskeyMutation(api, passkeyPaths.registrationVerify, { method: "POST" }));
  }

  const malformedApi = {
    async request<T>(path: string): Promise<T> {
      return (path === passkeyPaths.list ? [{ ...passkey(), extra: "unexpected" }] : { passkey: { ...passkey(), revokedAt: "invalid" } }) as T;
    },
  };
  await assert.rejects(() => requestPasskeyList(malformedApi));
  await assert.rejects(() => requestPasskeyMutation(malformedApi, passkeyRevokePath("passkey-1"), { method: "POST" }));
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
