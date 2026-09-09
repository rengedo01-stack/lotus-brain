import assert from "node:assert/strict";
import test from "node:test";
import {
  isStocktakeListPage,
  requestStocktakeList,
  stocktakeListPath,
  type StocktakeListApi,
} from "../lib/stocktakes.ts";
import { ApiError, createApiClient } from "../lib/api-client.ts";

const page = {
  items: [{
    id: "stocktake-list-1",
    status: "POSTED",
    startedAt: "2026-09-09T00:05:00.000Z",
    completedAt: "2026-09-09T01:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T01:00:00.000Z",
  }],
  nextCursor: "opaque-cursor",
};

test("stocktake list accepts only the exact header lifecycle contract", () => {
  assert.equal(isStocktakeListPage(page), true);
  assert.equal(isStocktakeListPage({ ...page, extra: true }), false);
  assert.equal(isStocktakeListPage({ ...page, items: [{ ...page.items[0], note: "not-a-list-field" }] }), false);
  assert.equal(isStocktakeListPage({ ...page, items: [{ ...page.items[0], productId: "master-product" }] }), false);
  assert.equal(isStocktakeListPage({ ...page, items: [{ ...page.items[0], startedAt: "2026-09-09" }] }), false);
  assert.equal(isStocktakeListPage({ ...page, items: [{ ...page.items[0], completedAt: 3 }] }), false);
  assert.equal(isStocktakeListPage({ ...page, items: [page.items[0], page.items[0]] }), false);
  assert.equal(isStocktakeListPage({ ...page, nextCursor: "" }), false);
});

test("stocktake list paths preserve exact filters and filter-bound cursors", () => {
  const path = stocktakeListPath({
    status: "CONFIRMED",
    createdFrom: "2026-09-01T00:00:00.000Z",
    createdTo: "2026-09-30T23:59:59.999Z",
  }, "cursor-value");
  const url = new URL(path, "https://web.example.test");
  assert.equal(url.pathname, "/stocktakes");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("status"), "CONFIRMED");
  assert.equal(url.searchParams.get("createdFrom"), "2026-09-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("createdTo"), "2026-09-30T23:59:59.999Z");
  assert.equal(url.searchParams.get("cursor"), "cursor-value");
});

test("stocktake list requires exact HTTP 200 and exact JSON before rendering", async (t) => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: StocktakeListApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return page as T;
    },
  };
  const result = await requestStocktakeList(api, { status: "POSTED" }, "cursor-value");
  assert.equal(result.items[0]?.id, "stocktake-list-1");
  assert.deepEqual(calls, [{ path: "/stocktakes?limit=50&status=POSTED&cursor=cursor-value", options: { expectedStatus: 200 } }]);

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
      () => requestStocktakeList(createApiClient(), {}),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ ...page, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestStocktakeList(createApiClient(), {}),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});
