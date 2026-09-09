import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  createReplenishmentPolicy,
  isReplenishmentPolicy,
  isReplenishmentPolicyContext,
  requestReplenishmentPolicyContext,
  replenishmentPolicyPath,
  updateReplenishmentPolicy,
  validateReorderPointQuantity,
  type ReplenishmentPolicyApi,
} from "../lib/replenishment-policy.ts";

const policy = {
  id: "policy-1",
  productId: "product-1",
  reorderPointQuantity: "12.500000000",
  version: 2,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T01:00:00.000Z",
};

const context = {
  product: {
    id: "product-1",
    code: "P-001",
    name: "商品",
    status: "ACTIVE",
    isDeleted: false,
    inventoryUnit: { code: "EA", name: "個", symbol: "個" },
  },
  policy,
};

test("replenishment policy accepts only its exact context and authoritative mutation contracts", () => {
  assert.equal(isReplenishmentPolicyContext(context), true);
  assert.equal(isReplenishmentPolicyContext({ ...context, extra: true }), false);
  assert.equal(isReplenishmentPolicyContext({ ...context, product: { ...context.product, baseUnitId: "unit-base" } }), false);
  assert.equal(isReplenishmentPolicyContext({ ...context, policy: { ...policy, reorderPointQuantity: "-1" } }), false);
  assert.equal(isReplenishmentPolicyContext({ ...context, policy: { ...policy, version: 0 } }), false);
  assert.equal(isReplenishmentPolicyContext({ ...context, policy: { ...policy, updatedAt: "2026-09-09" } }), false);
  assert.equal(isReplenishmentPolicyContext({ ...context, policy: null }), true);
  assert.equal(isReplenishmentPolicy({ ...policy, extra: true }), false);
  assert.equal(isReplenishmentPolicy({ ...policy, reorderPointQuantity: 1 }), false);
});

test("replenishment policy sends exact statuses and updates only from response authority", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ReplenishmentPolicyApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      if ((options as { method?: string } | undefined)?.method === "POST") return { ...policy, version: 1 } as T;
      if ((options as { method?: string } | undefined)?.method === "PATCH") return { ...policy, version: 3 } as T;
      return context as T;
    },
  };
  assert.equal(replenishmentPolicyPath("product/1"), "/products/product%2F1/replenishment-policy");
  assert.equal((await requestReplenishmentPolicyContext(api, "product-1")).policy?.version, 2);
  assert.equal((await createReplenishmentPolicy(api, "product-1", "0")).version, 1);
  assert.equal((await updateReplenishmentPolicy(api, "product-1", "12.5", 2)).version, 3);
  assert.deepEqual(calls, [
    { path: "/products/product-1/replenishment-policy", options: { expectedStatus: 200 } },
    { path: "/products/product-1/replenishment-policy", options: { method: "POST", body: { reorderPointQuantity: "0" }, expectedStatus: 201 } },
    { path: "/products/product-1/replenishment-policy", options: { method: "PATCH", body: { reorderPointQuantity: "12.5", expectedVersion: 2 }, expectedStatus: 200 } },
  ]);
});

test("replenishment policy rejects unexpected 2xx or malformed server responses", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; globalThis.fetch = originalFetch; });

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(context), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestReplenishmentPolicyContext(createApiClient(), "product-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...policy, extra: true }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createReplenishmentPolicy(createApiClient(), "product-1", "1"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("replenishment policy validation preserves inventory-unit Decimal semantics", () => {
  assert.equal(validateReorderPointQuantity("0"), null);
  assert.equal(validateReorderPointQuantity("123456789012345.123456789"), null);
  assert.match(validateReorderPointQuantity("-1") ?? "", /0以上/);
  assert.match(validateReorderPointQuantity("01") ?? "", /0以上/);
  assert.match(validateReorderPointQuantity("1.1234567890") ?? "", /0以上/);
  assert.match(validateReorderPointQuantity("1e3") ?? "", /0以上/);
});
