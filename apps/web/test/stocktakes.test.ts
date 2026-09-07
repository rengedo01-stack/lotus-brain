import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  isAmbiguousStocktakePostingError,
  isPostedStocktakeResult,
  isStocktake,
  mergePostedStocktakeResult,
  requestStocktakePosting,
  stocktakeFormFromStocktake,
  stocktakePayload,
  validateStocktakeForm,
  type StocktakePostingApi,
  type Stocktake,
} from "../lib/stocktakes.ts";

const stocktake: Stocktake = {
  id: "stocktake-1",
  status: "DRAFT",
  startedAt: null,
  completedAt: null,
  note: null,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  items: [{
    id: "server-stocktake-item-id",
    productId: "product-1",
    inventoryUnitId: "unit-1",
    systemQuantitySnapshot: "999999999.123456789",
    countedQuantity: "1000000000.123456789",
    differenceQuantity: "1.000000000",
    note: null,
  }],
};

test("stocktake create/update payload preserves decimal strings and excludes server-calculated fields", () => {
  const payload = stocktakePayload(stocktakeFormFromStocktake(stocktake));

  assert.deepEqual(payload.items, [{
    productId: "product-1",
    countedQuantity: "1000000000.123456789",
    note: undefined,
  }]);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("server-stocktake-item-id"), false);
  assert.equal(serialized.includes("999999999.123456789"), false);
  assert.equal(serialized.includes("1.000000000"), false);
});

test("stocktake form permits blank draft counts but rejects malformed decimal strings and duplicate products", () => {
  const blank = stocktakeFormFromStocktake({
    ...stocktake,
    items: [{ ...stocktake.items[0], countedQuantity: null }],
  });
  assert.deepEqual(validateStocktakeForm(blank), {});

  const invalid = {
    ...blank,
    items: [
      { ...blank.items[0], countedQuantity: "01.2" },
      { ...blank.items[0], rowKey: "stocktake-line-2", countedQuantity: "0" },
    ],
  };
  const errors = validateStocktakeForm(invalid);
  assert.equal(errors["items.stocktake-line-1.countedQuantity"], "実棚数量は0以上の10進数で入力してください。");
  assert.equal(errors["items.stocktake-line-2.productId"], "同じ商品は1回だけ追加してください。");
});

test("stocktake response guard rejects malformed lifecycle and decimal payloads", () => {
  assert.equal(isStocktake(stocktake), true);
  assert.equal(isStocktake({ ...stocktake, status: "COMPLETED" }), false);
  assert.equal(isStocktake({ ...stocktake, items: [{ ...stocktake.items[0], countedQuantity: 1 }] }), false);
  assert.equal(isStocktake({ ...stocktake, completedAt: 1 }), false);
});

test("stocktake posting response requires exact lifecycle keys and a canonical completion timestamp", () => {
  const posted = { id: stocktake.id, status: "POSTED", completedAt: "2026-08-22T01:02:03.000Z" } as const;
  assert.equal(isPostedStocktakeResult(posted, stocktake.id), true);
  assert.equal(isPostedStocktakeResult({ ...posted, extra: true }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult({ id: stocktake.id, status: "POSTED" }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult({ ...posted, id: "different-stocktake" }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult({ ...posted, status: "CONFIRMED" }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult({ ...posted, completedAt: "2026-08-22" }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult({ ...posted, completedAt: null }, stocktake.id), false);
  assert.equal(isPostedStocktakeResult([], stocktake.id), false);

  const merged = mergePostedStocktakeResult(stocktake, posted);
  assert.equal(merged.status, "POSTED");
  assert.equal(merged.completedAt, posted.completedAt);
  assert.equal(merged.items, stocktake.items);
});

test("stocktake posting uses exact HTTP 200 as lifecycle authority without a follow-up read", async () => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: StocktakePostingApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { id: stocktake.id, status: "POSTED", completedAt: "2026-08-22T01:02:03.000Z" } as T;
    },
  };

  const posted = await requestStocktakePosting(api, stocktake);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, `/stocktakes/${stocktake.id}/post`);
  assert.deepEqual(calls[0]?.options, { method: "POST", expectedStatus: 200 });
  assert.equal(posted.status, "POSTED");
});

test("stocktake posting rejects unexpected success statuses and malformed JSON", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify({ id: stocktake.id, status: "POSTED", completedAt: "2026-08-22T01:02:03.000Z" }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestStocktakePosting(createApiClient(), stocktake),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response("not json", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestStocktakePosting(createApiClient(), stocktake),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("ambiguous stocktake posting results require explicit reconciliation", () => {
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("server", 201)), true);
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("network")), true);
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("conflict", 409)), true);
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("validation", 422)), false);
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("forbidden", 403)), false);
  assert.equal(isAmbiguousStocktakePostingError(new ApiError("unauthorized", 401)), false);
});
