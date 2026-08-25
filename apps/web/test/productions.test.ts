import assert from "node:assert/strict";
import test from "node:test";
import {
  isActiveRecipeList,
  isPostedProductionResult,
  isProduction,
  productionCreatePayload,
  productionFormFromProduction,
  productionUpdatePayload,
  validateActualQuantity,
  validateProductionCreate,
  type Production,
} from "../lib/productions.ts";

const production: Production = {
  id: "production-1",
  recipe: { id: "recipe-revision-2", rootRecipeId: "recipe-root", revision: 2 },
  productionDate: "2026-08-23T00:00:00.000Z",
  plannedQuantity: "1000000000.123456789",
  actualQuantity: null,
  status: "DRAFT",
  note: null,
  postedAt: null,
  cancelledAt: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  output: { productId: "finished-product", yieldQuantity: "12.500000000", unitId: "unit-kg", conversionFactor: "1.000000000" },
  consumptions: [{
    id: "consumption-1",
    lineNumber: 1,
    productId: "ingredient-product",
    recipeQuantitySnapshot: "2.000000000",
    recipeUnitId: "unit-kg",
    inventoryQuantity: "2.000000000",
    inventoryUnitId: "unit-kg",
    conversionFactorSnapshot: "1.000000000",
    unitCostSnapshot: "0",
    amountSnapshot: "0",
    currency: "JPY",
  }],
};

test("production create and patch payloads preserve decimal strings and patch only E1 allowlisted fields", () => {
  const createPayload = productionCreatePayload({
    ...productionFormFromProduction(production),
    recipeId: "recipe-revision-2",
    note: " planned run ",
  });
  assert.deepEqual(createPayload, {
    recipeId: "recipe-revision-2",
    productionDate: "2026-08-23",
    plannedQuantity: "1000000000.123456789",
    note: "planned run",
  });

  const updatePayload = productionUpdatePayload(productionFormFromProduction(production));
  assert.deepEqual(updatePayload, {
    productionDate: "2026-08-23",
    plannedQuantity: "1000000000.123456789",
    note: null,
  });
  const serialized = JSON.stringify(updatePayload);
  assert.equal(serialized.includes("recipe-revision-2"), false);
  assert.equal(serialized.includes("finished-product"), false);
  assert.equal(serialized.includes("consumption-1"), false);
  assert.equal(serialized.includes("1.000000000"), false);
});

test("production validation accepts decimal strings without number conversion and rejects malformed or zero values", () => {
  assert.deepEqual(validateProductionCreate({
    recipeId: "recipe-1",
    productionDate: "2026-08-23",
    plannedQuantity: "999999999999999.123456789",
    note: "",
  }), {});
  assert.equal(validateActualQuantity("1000000000000000000000.123456789"), undefined);
  assert.equal(validateActualQuantity("0"), "実績生産量は正の10進数で入力してください。");
  assert.equal(validateActualQuantity("01.2"), "実績生産量は正の10進数で入力してください。");
  assert.equal(validateProductionCreate({ recipeId: "", productionDate: "not-a-date", plannedQuantity: "1.1234567890", note: "" }).recipeId, "有効なレシピを入力してください。");
});

test("production and lifecycle response guards require string decimals and safe post result shape", () => {
  assert.equal(isProduction(production), true);
  assert.equal(isProduction({ ...production, plannedQuantity: 1 }), false);
  assert.equal(isProduction({ ...production, output: { ...production.output, conversionFactor: "factor" } }), false);
  assert.equal(isProduction({ ...production, consumptions: [{ ...production.consumptions[0], amountSnapshot: 0 }] }), false);
  assert.equal(isPostedProductionResult({ id: "production-1", status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: "3.000000000" }, "production-1"), true);
  assert.equal(isPostedProductionResult({ id: "production-1", status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: 3 }, "production-1"), false);
  assert.equal(isPostedProductionResult({ id: "production-1", status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: "not-a-decimal" }, "production-1"), false);
});

test("only active recipe responses are selectable for production creation", () => {
  const activeRecipe = {
    id: "recipe-1",
    rootRecipeId: "recipe-root",
    name: "Finished good",
    outputProductId: "product-finished",
    yieldQuantity: "1.000000000",
    yieldUnitId: "unit-each",
    status: "ACTIVE",
    revision: 1,
    note: null,
    items: [{ id: "recipe-item-1", productId: "product-input", unitId: "unit-each", quantity: "2.000000000", sortOrder: 1 }],
  };
  assert.equal(isActiveRecipeList([activeRecipe]), true);
  assert.equal(isActiveRecipeList([{ ...activeRecipe, status: "ARCHIVED" }]), false);
  assert.equal(isActiveRecipeList([{ ...activeRecipe, items: [{ ...activeRecipe.items[0], quantity: 2 }] }]), false);
});
