import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import { currentInventoryPath, inventoryHistoryPath, inventoryProductStateLabel, inventorySupplyContextPath, inventoryTransactionLabel, isCurrentInventoryPage, isInventoryHistoryPage, isInventorySupplyContextPage, requestInventorySupplyContext, type InventorySupplyContextApi } from "../lib/inventory.ts";

const current = {
  product: { id: "product-1", code: "P-001", name: "商品", status: "ACTIVE", isDeleted: false },
  quantity: "123456789.123456789",
  inventoryUnit: { code: "EA", name: "個", symbol: "個" },
  updatedAt: "2026-09-08T00:00:00.000Z",
};

const history = {
  id: "history-1",
  type: "RECEIPT",
  quantityDelta: "1.000000000",
  quantityAfter: "123456790.123456789",
  occurredAt: "2026-09-08T00:00:00.000Z",
  inventoryUnit: { code: "EA", name: "個", symbol: "個" },
};

const supplyContext = {
  product: { id: "product-1", code: "P-001", name: "商品" },
  inventoryUnit: { code: "EA", name: "個", symbol: "個" },
  currentQuantity: "123456789.123456789",
  draftPurchaseQuantity: "2.000000000",
  confirmedPurchaseQuantity: "3.000000000",
};

test("inventory list accepts only its exact documented response and preserves decimal strings", () => {
  const page = { items: [current], nextCursor: "opaque-cursor" };
  assert.equal(isCurrentInventoryPage(page), true);
  assert.equal(isCurrentInventoryPage({ ...page, averageUnitCost: "1" }), false);
  assert.equal(isCurrentInventoryPage({ items: [{ ...current, quantity: 1 }], nextCursor: null }), false);
  assert.equal(isCurrentInventoryPage({ items: [{ ...current, product: { ...current.product, deletedAt: "2026-01-01T00:00:00.000Z" } }], nextCursor: null }), false);
  assert.equal(isCurrentInventoryPage({ items: [current], nextCursor: 1 }), false);
});

test("inventory history accepts only authoritative fields and rejects cost or document leakage", () => {
  const page = { currentInventory: current, items: [history], nextCursor: null };
  assert.equal(isInventoryHistoryPage(page), true);
  assert.equal(isInventoryHistoryPage({ ...page, items: [{ ...history, sourcePurchaseItemId: "purchase-item" }] }), false);
  assert.equal(isInventoryHistoryPage({ ...page, items: [{ ...history, quantityAfter: "not-a-decimal" }] }), false);
  assert.equal(isInventoryHistoryPage({ ...page, items: [{ ...history, type: "OTHER" }] }), false);
  assert.equal(isInventoryHistoryPage({ ...page, items: [{ ...history, occurredAt: "2026-09-08" }] }), false);
});

test("inventory supply context accepts only independent fact fields", () => {
  const page = { items: [supplyContext], nextCursor: "opaque-cursor" };
  assert.equal(isInventorySupplyContextPage(page), true);
  assert.equal(isInventorySupplyContextPage({ ...page, availableQuantity: "3" }), false);
  assert.equal(isInventorySupplyContextPage({ ...page, items: [{ ...supplyContext, supplier: { code: "S", name: "Supplier" } }] }), false);
  assert.equal(isInventorySupplyContextPage({ ...page, items: [{ ...supplyContext, currentQuantity: 1 }] }), false);
  assert.equal(isInventorySupplyContextPage({ ...page, items: [{ ...supplyContext, product: { ...supplyContext.product, status: "ACTIVE" } }] }), false);
  assert.equal(isInventorySupplyContextPage({ ...page, items: [{ ...supplyContext, draftPurchaseQuantity: "not-a-decimal" }] }), false);
});

test("inventory URL construction uses bounded keyset requests and encodes filters", () => {
  assert.equal(currentInventoryPath("P 001", "next+cursor"), "/inventory?limit=50&productCode=P+001&cursor=next%2Bcursor");
  assert.equal(inventoryHistoryPath("product/1", { type: "CONSUMPTION", from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" }, "cursor"), "/inventory/product%2F1/history?limit=50&type=CONSUMPTION&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&cursor=cursor");
  assert.equal(inventorySupplyContextPath("P 001", "next+cursor"), "/inventory/supply-context?limit=50&productCode=P+001&cursor=next%2Bcursor");
});

test("inventory supply context requires exact HTTP 200 and the strict response before rendering", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: InventorySupplyContextApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { items: [supplyContext], nextCursor: null } as T;
    },
  };
  const page = await requestInventorySupplyContext(api, "P 001", "cursor-value");
  assert.equal(page.items[0]?.currentQuantity, "123456789.123456789");
  assert.deepEqual(calls, [{ path: "/inventory/supply-context?limit=50&productCode=P+001&cursor=cursor-value", options: { expectedStatus: 200 } }]);

  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl; globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify({ items: [supplyContext], nextCursor: null }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestInventorySupplyContext(createApiClient()),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [supplyContext], nextCursor: null, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestInventorySupplyContext(createApiClient()),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("inventory labels remain a presentation mapping of persisted types only", () => {
  assert.equal(inventoryTransactionLabel("STOCKTAKE_ADJUSTMENT"), "棚卸調整");
  assert.equal(inventoryProductStateLabel({ ...current.product, status: "INACTIVE" }), "無効");
  assert.equal(inventoryProductStateLabel({ ...current.product, isDeleted: true }), "削除済み");
});
