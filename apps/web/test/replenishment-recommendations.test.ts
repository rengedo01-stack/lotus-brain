import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  dismissReplenishmentRecommendation,
  isActiveReplenishmentRecommendationResponse,
  isReplenishmentRecommendation,
  recalculateReplenishmentRecommendation,
  replenishmentRecommendationPath,
  requestActiveReplenishmentRecommendation,
  type ReplenishmentRecommendation,
  type ReplenishmentRecommendationApi,
} from "../lib/replenishment-recommendations.ts";

const recommendation: ReplenishmentRecommendation = {
  id: "recommendation-1", disposition: "ACTIVE", version: 1, calculationPolicyVersion: 1,
  createdAt: "2026-09-12T00:00:00.000Z", supersededAt: null, dismissedAt: null, freshness: "CURRENT",
  product: { id: "product-1", code: "P-001", name: "Product" },
  inventoryUnit: { code: "EA", name: "Each", symbol: "ea" },
  snapshot: {
    currentQuantity: "5.000000000", inventoryVersion: 2, reorderPointQuantity: "5.000000000", targetStockQuantity: "12.000000000", replenishmentPolicyVersion: 3,
    draftPurchaseQuantity: "100.000000000", confirmedPurchaseQuantity: "200.000000000",
    preferredSupplier: { relationshipId: "relationship-1", relationshipVersion: 4, preferenceVersion: 2, supplier: { id: "supplier-1", code: "SUP-001", name: "Supplier" } },
    orderingTerms: { minimumOrderQuantity: "10.000000000", orderMultipleQuantity: "5.000000000", version: 3 },
    preferredPackage: { id: "package-1", code: "CASE", name: "Case", inventoryQuantityPerPackage: "10.000000000", version: 5, preferenceVersion: 2 },
    result: { rawTargetGap: "7", feasibleQuantity: "10", overOrderQuantity: "3", packageCount: "1" },
  },
};

test("replenishment recommendation accepts only the exact immutable snapshot contract", () => {
  assert.equal(isReplenishmentRecommendation(recommendation), true);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, extra: true }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, freshness: "READY" }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, createdAt: "2026-09-12" }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, snapshot: { ...recommendation.snapshot, inventoryVersion: 0 } }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, snapshot: { ...recommendation.snapshot, preferredSupplier: { ...recommendation.snapshot.preferredSupplier, extra: true } } }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, snapshot: { ...recommendation.snapshot, result: { ...recommendation.snapshot.result, packageCount: "1.5" } } }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, snapshot: { ...recommendation.snapshot, preferredPackage: null } }), false);
  assert.equal(isReplenishmentRecommendation({ ...recommendation, disposition: "SUPERSEDED" }), false);
  assert.equal(isActiveReplenishmentRecommendationResponse({ recommendation: null }), true);
  assert.equal(isActiveReplenishmentRecommendationResponse({ recommendation: null, extra: true }), false);
});

test("recommendation paths encode Product identifiers", () => {
  assert.equal(replenishmentRecommendationPath("product/1"), "/inventory/product%2F1/replenishment-recommendation");
});

test("read, recalculate, and dismiss use exact HTTP 200 plus exact response JSON", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ReplenishmentRecommendationApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { recommendation } as T;
    },
  };
  assert.equal((await requestActiveReplenishmentRecommendation(api, "product/1"))?.id, recommendation.id);
  assert.equal((await recalculateReplenishmentRecommendation(api, "product/1")).id, recommendation.id);
  assert.equal((await dismissReplenishmentRecommendation(api, "product/1", recommendation.id, 1)).id, recommendation.id);
  assert.deepEqual(calls, [
    { path: "/inventory/product%2F1/replenishment-recommendation", options: { expectedStatus: 200 } },
    { path: "/inventory/product%2F1/replenishment-recommendation", options: { method: "POST", expectedStatus: 200 } },
    { path: "/inventory/product%2F1/replenishment-recommendation/recommendation-1/dismiss", options: { method: "POST", body: { expectedVersion: 1 }, expectedStatus: 200 } },
  ]);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; globalThis.fetch = previousFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify({ recommendation }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => recalculateReplenishmentRecommendation(createApiClient(), "product-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ recommendation: { ...recommendation, extra: true } }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => dismissReplenishmentRecommendation(createApiClient(), "product-1", recommendation.id, 1),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});
