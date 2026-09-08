import assert from "node:assert/strict";
import test from "node:test";
import { currentInventoryPath, inventoryHistoryPath, inventoryProductStateLabel, inventoryTransactionLabel, isCurrentInventoryPage, isInventoryHistoryPage } from "../lib/inventory.ts";

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

test("inventory URL construction uses bounded keyset requests and encodes filters", () => {
  assert.equal(currentInventoryPath("P 001", "next+cursor"), "/inventory?limit=50&productCode=P+001&cursor=next%2Bcursor");
  assert.equal(inventoryHistoryPath("product/1", { type: "CONSUMPTION", from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" }, "cursor"), "/inventory/product%2F1/history?limit=50&type=CONSUMPTION&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&cursor=cursor");
});

test("inventory labels remain a presentation mapping of persisted types only", () => {
  assert.equal(inventoryTransactionLabel("STOCKTAKE_ADJUSTMENT"), "棚卸調整");
  assert.equal(inventoryProductStateLabel({ ...current.product, status: "INACTIVE" }), "無効");
  assert.equal(inventoryProductStateLabel({ ...current.product, isDeleted: true }), "削除済み");
});
