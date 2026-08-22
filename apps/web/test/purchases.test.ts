import assert from "node:assert/strict";
import test from "node:test";
import {
  isPurchase,
  purchaseFormFromPurchase,
  purchasePayload,
  validatePurchaseForm,
  type Purchase,
} from "../lib/purchases.ts";

const purchase: Purchase = {
  id: "purchase-1",
  supplier: { id: "supplier-1", code: "SUP-001", name: "仕入先" },
  status: "DRAFT",
  purchaseDate: "2026-08-21T00:00:00.000Z",
  documentNumber: null,
  note: null,
  subtotal: "123456789012.123456",
  tax: "0",
  total: "123456789012.123456",
  postedAt: null,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  items: [{
    id: "server-line-id",
    lineNumber: 1,
    productId: "product-1",
    unitId: "unit-1",
    quantity: "123456789.123456789",
    unitPrice: "987654321.123456",
    taxRate: "0.1",
    lineAmount: "121932631234567900.000000",
  }],
};

test("purchase create/update payload preserves decimal strings and excludes UI/server item identity", () => {
  const form = purchaseFormFromPurchase(purchase);
  const payload = purchasePayload(form);

  assert.deepEqual(payload.items, [{
    productId: "product-1",
    unitId: "unit-1",
    quantity: "123456789.123456789",
    unitPrice: "987654321.123456",
    taxRate: "0.1",
  }]);
  assert.equal(JSON.stringify(payload).includes("server-line-id"), false);
  assert.equal(JSON.stringify(payload).includes("purchase-line-1"), false);
});

test("purchase form validation rejects zero quantity and tax rates above one without numeric conversion", () => {
  const form = purchaseFormFromPurchase(purchase);
  form.items[0] = { ...form.items[0], quantity: "0.000", taxRate: "1.0001" };

  const errors = validatePurchaseForm(form);
  assert.equal(errors["items.purchase-line-1.quantity"], "数量は0より大きい値を入力してください。");
  assert.equal(errors["items.purchase-line-1.taxRate"], "税率は0から1までの値を入力してください。");
  assert.equal(validatePurchaseForm({ ...form, purchaseDate: "2026/08/21" }).purchaseDate, "仕入日は YYYY-MM-DD 形式で入力してください。");
});

test("purchase response guards reject malformed lifecycle payloads", () => {
  assert.equal(isPurchase(purchase), true);
  assert.equal(isPurchase({ ...purchase, status: "SAVED" }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], quantity: 1 }] }), false);
});
