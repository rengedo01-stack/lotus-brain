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

function expectBootstrapRejection(responses: Record<string, unknown | Error>): Promise<unknown> {
  const coordinator = new AuthenticationBootstrapCoordinator();
  return assert.rejects(
    () => bootstrapOperationalAuthentication(apiWithResponses(responses), coordinator, coordinator.begin()),
  );
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

test("bootstrap sends an exact-200 contract for both session responses", async () => {
  const coordinator = new AuthenticationBootstrapCoordinator();
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: AuthenticationApi = {
    async request<T>(path: string, options?: { expectedStatus?: number }): Promise<T> {
      calls.push({ path, options });
      return (path === "/auth/me" ? { user: currentUser } : { permissions: ["master.read"] }) as T;
    },
  };

  await bootstrapOperationalAuthentication(api, coordinator, coordinator.begin());
  assert.deepEqual(calls, [
    { path: "/auth/me", options: { expectedStatus: 200 } },
    { path: "/auth/me/permissions", options: { expectedStatus: 200 } },
  ]);
});

test("any malformed current-user contract rejects the whole bootstrap", async () => {
  for (const malformedMe of [
    { user: currentUser, extra: true },
    { user: { ...currentUser, extra: true } },
    { user: { ...currentUser, status: "DISABLED" } },
    { user: { ...currentUser, lastLoginAt: "not-a-prisma-date" } },
    { user: { ...currentUser, updatedAt: null } },
  ]) {
    await expectBootstrapRejection({
      "/auth/me": malformedMe,
      "/auth/me/permissions": { permissions: ["master.read"] },
    });
  }
});

test("any malformed permissions contract rejects the whole bootstrap", async () => {
  for (const malformedPermissions of [
    { permissions: ["master.read"], extra: true },
    { permissions: ["master.read", "master.read"] },
    { permissions: ["master.read", "future.permission"] },
    { permissions: "master.read" },
  ]) {
    await expectBootstrapRejection({
      "/auth/me": { user: currentUser },
      "/auth/me/permissions": malformedPermissions,
    });
  }
});

test("valid permission ordering remains a server detail rather than a client bootstrap contract", async () => {
  const coordinator = new AuthenticationBootstrapCoordinator();
  const result = await bootstrapOperationalAuthentication(apiWithResponses({
    "/auth/me": { user: currentUser },
    "/auth/me/permissions": { permissions: ["purchase.read", "master.read"] },
  }), coordinator, coordinator.begin());

  assert.deepEqual([...result?.permissions ?? []], ["purchase.read", "master.read"]);
});

test("a partial bootstrap never returns ready authentication state", async () => {
  await expectBootstrapRejection({
    "/auth/me": { user: currentUser },
    "/auth/me/permissions": new ApiError("server", 201),
  });
  await expectBootstrapRejection({
    "/auth/me": new ApiError("server", 201),
    "/auth/me/permissions": { permissions: ["master.read"] },
  });
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
