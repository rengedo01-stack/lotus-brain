const test = require("node:test");
const assert = require("node:assert/strict");

const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");
const {
  RecommendationPurchaseHandoffConflictError,
  RecommendationPurchaseHandoffNotFoundError,
} = require("../dist/modules/purchase/application/recommendation-purchase-handoff.errors.js");
const {
  recommendationPurchaseDraftHandoffResponseSchema,
  recommendationPurchaseHandoffLineageResponseSchema,
} = require("../dist/modules/purchase/presentation/purchase-response.schemas.js");

const purchase = {
  id: "purchase-1", supplier: { id: "supplier-1", code: "SUP-1", name: "Supplier" }, status: "DRAFT",
  purchaseDate: new Date("2026-09-14T00:00:00.000Z"), documentNumber: null, note: null,
  subtotal: "12.345678", tax: "1.234567", total: "13.580245", postedAt: null,
  createdAt: new Date("2026-09-14T00:00:00.000Z"), updatedAt: new Date("2026-09-14T00:00:00.000Z"),
  items: [{ id: "item-1", lineNumber: 1, productId: "product-1", unitId: "unit-1", quantity: "10", unitPrice: "1.234568", taxRate: "0.1000", lineAmount: "12.345680" }],
};

function controller(handoff, getHandoff = {}) {
  return new PurchaseController({}, {}, {}, {}, {}, {}, {}, handoff, getHandoff);
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

test("recommendation handoff lineage is read-only, exact, and distinguishes no handoff from no Recommendation", async () => {
  const lineage = {
    sourceRecommendationId: "rec-1",
    createdAt: new Date("2026-09-14T00:00:00.000Z"),
    purchase: { id: "purchase-1", status: "DRAFT", purchaseDate: new Date("2026-09-14T00:00:00.000Z") },
    purchaseItem: { id: "item-1" },
    source: {
      relationshipId: "relationship-1",
      supplierId: "supplier-1",
      recommendedQuantity: "10.000000000",
      package: { id: "package-1", code: "CASE", quantity: "10.000000000", version: 1 },
      commercialTerms: { id: "terms-1", version: 1, unitPrice: "12.345678", currencyCode: "JPY", taxRate: "0.1000" },
    },
  };
  const instance = controller({}, { execute: async () => lineage });
  const response = await instance.getRecommendationPurchaseHandoff("rec-1");
  assert.deepEqual(Object.keys(response), ["handoff"]);
  assert.equal(response.handoff.purchase.id, "purchase-1");
  assert.equal(recommendationPurchaseHandoffLineageResponseSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(recommendationPurchaseHandoffLineageResponseSchema.properties), ["handoff"]);

  const noHandoff = controller({}, { execute: async () => null });
  assert.deepEqual(await noHandoff.getRecommendationPurchaseHandoff("rec-1"), { handoff: null });

  const missing = controller({}, { execute: async () => { throw new RecommendationPurchaseHandoffNotFoundError("missing"); } });
  await assert.rejects(
    () => missing.getRecommendationPurchaseHandoff("missing"),
    (error) => error?.name === "NotFoundException",
  );
});
