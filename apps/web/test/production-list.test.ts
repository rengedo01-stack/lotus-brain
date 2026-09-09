import assert from "node:assert/strict";
import test from "node:test";
import {
  isProductionListPage,
  productionListPath,
  requestProductionList,
  type ProductionListApi,
} from "../lib/productions.ts";
import { ApiError, createApiClient } from "../lib/api-client.ts";

const page = {
  items: [{
    id: "production-list-1",
    status: "POSTED",
    productionDate: "2026-09-09T00:00:00.000Z",
    outputProductIdSnapshot: "product-output-1",
    recipe: { id: "recipe-1", rootRecipeId: "recipe-root-1", revision: 2 },
    postedAt: "2026-09-09T01:00:00.000Z",
    cancelledAt: null,
  }],
  nextCursor: "opaque-cursor",
};

test("production list accepts only the exact Production-owned summary contract", () => {
  assert.equal(isProductionListPage(page), true);
  assert.equal(isProductionListPage({ ...page, extra: true }), false);
  assert.equal(isProductionListPage({ ...page, items: [{ ...page.items[0], productName: "current-master" }] }), false);
  assert.equal(isProductionListPage({ ...page, items: [{ ...page.items[0], confirmedAt: null }] }), false);
  assert.equal(isProductionListPage({ ...page, items: [{ ...page.items[0], outputProductIdSnapshot: "" }] }), false);
  assert.equal(isProductionListPage({ ...page, items: [{ ...page.items[0], recipe: { ...page.items[0].recipe, revision: 0 } }] }), false);
  assert.equal(isProductionListPage({ ...page, items: [{ ...page.items[0], productionDate: "2026-09-09" }] }), false);
  assert.equal(isProductionListPage({ ...page, items: [page.items[0], page.items[0]] }), false);
  assert.equal(isProductionListPage({ ...page, nextCursor: "" }), false);
});

test("production list paths preserve exact filters and filter-bound cursors", () => {
  const path = productionListPath({
    status: "CONFIRMED",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
    recipeId: "recipe-1",
    outputProductIdSnapshot: "product-output-1",
  }, "cursor-value");
  const url = new URL(path, "https://web.example.test");
  assert.equal(url.pathname, "/productions");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("status"), "CONFIRMED");
  assert.equal(url.searchParams.get("from"), "2026-09-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-09-30T23:59:59.999Z");
  assert.equal(url.searchParams.get("recipeId"), "recipe-1");
  assert.equal(url.searchParams.get("outputProductIdSnapshot"), "product-output-1");
  assert.equal(url.searchParams.get("cursor"), "cursor-value");
});

test("production list requires exact HTTP 200 and exact JSON before rendering", async (t) => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: ProductionListApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return page as T;
    },
  };
  const result = await requestProductionList(api, { status: "POSTED" }, "cursor-value");
  assert.equal(result.items[0]?.id, "production-list-1");
  assert.deepEqual(calls, [{ path: "/productions?limit=50&status=POSTED&cursor=cursor-value", options: { expectedStatus: 200 } }]);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(page), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductionList(createApiClient(), {}),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ ...page, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestProductionList(createApiClient(), {}),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});
