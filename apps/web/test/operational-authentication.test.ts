import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-client.ts";
import {
  AuthenticationBootstrapCoordinator,
  bootstrapOperationalAuthentication,
  isBfcacheRestore,
  type AuthenticationApi,
} from "../lib/operational-authentication.ts";

const currentUser = {
  id: "user-1",
  email: "staff@example.test",
  displayName: "Staff",
  status: "ACTIVE",
  lastLoginAt: null,
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

function apiWithResponses(responses: Record<string, unknown | Error>): AuthenticationApi {
  return {
    async request<T>(path: string): Promise<T> {
      const response = responses[path];
      if (response instanceof Error) throw response;
      return response as T;
    },
  };
}

test("BFCache pageshow is the only pageshow that triggers authentication revalidation", () => {
  assert.equal(isBfcacheRestore({ persisted: true }), true);
  assert.equal(isBfcacheRestore({ persisted: false }), false);
});

test("protected state reset invalidates an older bootstrap before it can become ready", async () => {
  const coordinator = new AuthenticationBootstrapCoordinator();
  let resolveMe: ((value: unknown) => void) | undefined;
  const api: AuthenticationApi = {
    request<T>(path: string): Promise<T> {
      if (path === "/auth/me") {
        return new Promise((resolve) => {
          resolveMe = resolve;
        }) as Promise<T>;
      }
      return Promise.resolve({ permissions: ["master.read"] } as T);
    },
  };
  const generation = coordinator.begin();
  const pending = bootstrapOperationalAuthentication(api, coordinator, generation);

  coordinator.invalidate();
  resolveMe?.({ user: currentUser });

  assert.equal(await pending, null);
});

test("a valid BFCache rebootstrap returns only the current user and effective permissions", async () => {
  const coordinator = new AuthenticationBootstrapCoordinator();
  const generation = coordinator.begin();
  const result = await bootstrapOperationalAuthentication(apiWithResponses({
    "/auth/me": { user: currentUser },
    "/auth/me/permissions": { permissions: ["master.read"] },
  }), coordinator, generation);

  assert.equal(result?.user.email, currentUser.email);
  assert.deepEqual([...result?.permissions ?? []], ["master.read"]);
});

test("an unauthorized BFCache bootstrap cannot produce authenticated state", async () => {
  const coordinator = new AuthenticationBootstrapCoordinator();
  const generation = coordinator.begin();
  await assert.rejects(
    () => bootstrapOperationalAuthentication(apiWithResponses({
      "/auth/me": new ApiError("unauthorized", 401),
      "/auth/me/permissions": { permissions: ["master.read"] },
    }), coordinator, generation),
    (error: unknown) => error instanceof ApiError && error.kind === "unauthorized",
  );
  coordinator.invalidate();
  assert.equal(coordinator.isCurrent(generation), false);
});
