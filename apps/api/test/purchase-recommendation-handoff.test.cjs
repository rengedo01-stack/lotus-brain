const test = require("node:test");
const assert = require("node:assert/strict");

const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");
const {
  RecommendationPurchaseHandoffConflictError,
  RecommendationPurchaseHandoffNotFoundError,
} = require("../dist/modules/purchase/application/recommendation-purchase-handoff.errors.js");
const { recommendationPurchaseDraftHandoffResponseSchema } = require("../dist/modules/purchase/presentation/purchase-response.schemas.js");

const purchase = {
  id: "purchase-1", supplier: { id: "supplier-1", code: "SUP-1", name: "Supplier" }, status: "DRAFT",
  purchaseDate: new Date("2026-09-14T00:00:00.000Z"), documentNumber: null, note: null,
  subtotal: "12.345678", tax: "1.234567", total: "13.580245", postedAt: null,
  createdAt: new Date("2026-09-14T00:00:00.000Z"), updatedAt: new Date("2026-09-14T00:00:00.000Z"),
  items: [{ id: "item-1", lineNumber: 1, productId: "product-1", unitId: "unit-1", quantity: "10", unitPrice: "1.234568", taxRate: "0.1000", lineAmount: "12.345680" }],
};

function controller(handoff) {
  return new PurchaseController({}, {}, {}, {}, {}, {}, {}, handoff);
}

test("recommendation handoff returns only an exact purchase wrapper and distinguishes create from replay by status", async () => {
  const dates = [];
  const instance = controller({ execute: async (_id, date) => { dates.push(date.toISOString()); return { replayed: dates.length > 1, purchase }; } });
  const firstResponse = { value: null, status(value) { this.value = value; return this; } };
  const first = await instance.createRecommendationPurchaseDraft("rec-1", { purchaseDate: "2026-09-14T00:00:00.000Z" }, firstResponse);
  const replayResponse = { value: null, status(value) { this.value = value; return this; } };
  const replay = await instance.createRecommendationPurchaseDraft("rec-1", { purchaseDate: "2027-01-01T00:00:00.000Z" }, replayResponse);
  assert.deepEqual(Object.keys(first), ["purchase"]);
  assert.equal(first.purchase.id, purchase.id);
  assert.equal(firstResponse.value, 201);
  assert.equal(replayResponse.value, 200);
  assert.equal(replay.purchase.id, purchase.id);
  assert.deepEqual(dates, ["2026-09-14T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  assert.equal(recommendationPurchaseDraftHandoffResponseSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(recommendationPurchaseDraftHandoffResponseSchema.properties), ["purchase"]);
});

test("recommendation handoff maps unavailable and ineligible states without inferring a Purchase", async () => {
  const missing = controller({ execute: async () => { throw new RecommendationPurchaseHandoffNotFoundError("missing"); } });
  await assert.rejects(
    () => missing.createRecommendationPurchaseDraft("missing", { purchaseDate: "2026-09-14T00:00:00.000Z" }, { status() { return this; } }),
    (error) => error?.name === "NotFoundException",
  );
  const conflict = controller({ execute: async () => { throw new RecommendationPurchaseHandoffConflictError("ineligible"); } });
  await assert.rejects(
    () => conflict.createRecommendationPurchaseDraft("rec-1", { purchaseDate: "2026-09-14T00:00:00.000Z" }, { status() { return this; } }),
    (error) => error?.name === "ConflictException",
  );
});
