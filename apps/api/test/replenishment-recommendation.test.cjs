const test = require("node:test");
const assert = require("node:assert/strict");

const { ReplenishmentRecommendationController } = require("../dist/modules/replenishment/presentation/replenishment-recommendation.controller.js");
const { ReplenishmentRecommendationNotFoundError, ReplenishmentRecommendationConflictError } = require("../dist/modules/replenishment/application/replenishment-recommendation.errors.js");
const { replenishmentRecommendationResponseSchema, recalculatedReplenishmentRecommendationResponseSchema } = require("../dist/modules/replenishment/presentation/replenishment-recommendation-response.schemas.js");

const recommendation = {
  id: "recommendation-1", disposition: "ACTIVE", version: 1, calculationPolicyVersion: 1,
  createdAt: new Date("2026-09-12T00:00:00.000Z"), supersededAt: null, dismissedAt: null, freshness: "CURRENT",
  product: { id: "product-1", code: "P-001", name: "Product" },
  inventoryUnit: { code: "EA", name: "Each", symbol: "ea" },
  snapshot: {
    currentQuantity: "5.000000000", inventoryVersion: 2, reorderPointQuantity: "5.000000000", targetStockQuantity: "12.000000000", replenishmentPolicyVersion: 1,
    draftPurchaseQuantity: "4.000000000", confirmedPurchaseQuantity: "6.000000000",
    preferredSupplier: { relationshipId: "relationship-1", relationshipVersion: 1, preferenceVersion: 1, supplier: { id: "supplier-1", code: "SUP-001", name: "Supplier" } },
    orderingTerms: { minimumOrderQuantity: "10.000000000", orderMultipleQuantity: "5.000000000", version: 1 },
    preferredPackage: { id: "package-1", code: "CASE", name: "Case", inventoryQuantityPerPackage: "10.000000000", version: 1, preferenceVersion: 1 },
    result: { rawTargetGap: "7", feasibleQuantity: "10", overOrderQuantity: "3", packageCount: "1" },
  },
};

test("replenishment recommendation controller exposes only the lifecycle snapshot response", async () => {
  const calls = [];
  const controller = new ReplenishmentRecommendationController(
    { execute: async (productId) => { calls.push(["get", productId]); return { recommendation: null }; } },
    { execute: async (productId, actorId) => { calls.push(["recalculate", productId, actorId]); return { recommendation }; } },
    { execute: async (productId, recommendationId, expectedVersion, actorId) => { calls.push(["dismiss", productId, recommendationId, expectedVersion, actorId]); return { recommendation: { ...recommendation, disposition: "DISMISSED", version: 2, dismissedAt: new Date("2026-09-12T01:00:00.000Z") } }; } },
  );
  assert.deepEqual(await controller.getActive("product-1"), { recommendation: null });
  assert.equal((await controller.recalculate({ authUser: { id: "actor-1" } }, "product-1")).recommendation.id, recommendation.id);
  const dismissed = await controller.dismiss({ authUser: { id: "actor-1" } }, "product-1", recommendation.id, { expectedVersion: 1 });
  assert.equal(dismissed.recommendation.disposition, "DISMISSED");
  assert.deepEqual(calls, [["get", "product-1"], ["recalculate", "product-1", "actor-1"], ["dismiss", "product-1", "recommendation-1", 1, "actor-1"]]);
  assert.deepEqual(Object.keys(replenishmentRecommendationResponseSchema.properties).sort(), ["recommendation"]);
  assert.equal(replenishmentRecommendationResponseSchema.additionalProperties, false);
  assert.equal(recalculatedReplenishmentRecommendationResponseSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(replenishmentRecommendationResponseSchema.properties.recommendation, "properties"), false);
  assert.equal(Object.hasOwn(recalculatedReplenishmentRecommendationResponseSchema.properties.recommendation.properties, "purchaseId"), false);
  assert.equal(Object.hasOwn(recalculatedReplenishmentRecommendationResponseSchema.properties.recommendation.properties, "price"), false);
});

test("replenishment recommendation controller maps not-found and conflict without a client-supplied actor", async () => {
  const controller = new ReplenishmentRecommendationController(
    { execute: async () => ({ recommendation }) },
    { execute: async () => { throw new ReplenishmentRecommendationNotFoundError("product-1"); } },
    { execute: async () => { throw new ReplenishmentRecommendationConflictError(); } },
  );
  await assert.rejects(() => controller.recalculate({ authUser: { id: "actor-1" } }, "product-1"), (error) => error?.name === "NotFoundException");
  await assert.rejects(() => controller.dismiss({ authUser: { id: "actor-1" } }, "product-1", "recommendation-1", { expectedVersion: 1 }), (error) => error?.name === "ConflictException");
  await assert.rejects(() => controller.recalculate({}, "product-1"), (error) => error?.name === "UnauthorizedException");
});
