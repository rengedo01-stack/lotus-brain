import assert from "node:assert/strict";
import test from "node:test";
import {
  isStocktake,
  stocktakeFormFromStocktake,
  stocktakePayload,
  validateStocktakeForm,
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
