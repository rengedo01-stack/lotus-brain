import assert from "node:assert/strict";
import test from "node:test";
import { stageRecipeNavigation, takeStagedRecipe } from "../lib/recipe-navigation.ts";
import { isRecipe, isRecipeList, recipeDraftPayload, recipeFormFromRecipe, validateRecipeForm, type Recipe } from "../lib/recipes.ts";

const recipe: Recipe = {
  id: "recipe-r2", rootRecipeId: "recipe-root", name: "Finished good", outputProductId: "product-output", yieldQuantity: "999999999999999.123456789", yieldUnitId: "unit-kg", status: "DRAFT", revision: 2, note: null,
  createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z",
  items: [{ id: "item-1", productId: "product-input", unitId: "unit-kg", quantity: "2.000000000", sortOrder: 0 }],
};

test("Recipe guards require bounded string decimals and complete immutable lineage", () => {
  assert.equal(isRecipe(recipe), true);
  assert.equal(isRecipe({ ...recipe, revision: "2" }), false);
  assert.equal(isRecipe({ ...recipe, yieldQuantity: 2 }), false);
  assert.equal(isRecipe({ ...recipe, items: [{ ...recipe.items[0], quantity: "2.0000000000" }] }), false);
  assert.equal(isRecipeList([recipe]), true);
});

test("Recipe draft payload preserves decimal strings and excludes UI-only item keys", () => {
  const payload = recipeDraftPayload(recipeFormFromRecipe(recipe));
  assert.deepEqual(payload, { name: "Finished good", outputProductId: "product-output", yieldQuantity: "999999999999999.123456789", yieldUnitId: "unit-kg", note: null, items: [{ productId: "product-input", unitId: "unit-kg", quantity: "2.000000000" }] });
  assert.equal(JSON.stringify(payload).includes("clientKey"), false);
});

test("Recipe validation rejects duplicate BOM products and invalid decimal boundaries without number coercion", () => {
  const values = recipeFormFromRecipe(recipe);
  values.items.push({ clientKey: "item-2", productId: "product-input", unitId: "unit-kg", quantity: "1" });
  const errors = validateRecipeForm(values);
  assert.equal(errors["items.1.productId"], "同一商品はBOMに1行だけ指定できます。");
  assert.equal(validateRecipeForm({ ...values, items: [values.items[0]], yieldQuantity: "0" }).yieldQuantity, "歩留まりはDecimal(24,9)に収まる正の10進数で入力してください。");
});

test("Recipe mutation responses can cross a client route transition without browser storage or a follow-up read", () => {
  stageRecipeNavigation(recipe);
  assert.equal(takeStagedRecipe(recipe.id), recipe);
  assert.equal(takeStagedRecipe(recipe.id), undefined);
});
