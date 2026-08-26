import type { Recipe } from "./recipes";

// This short-lived, in-memory handoff keeps a successful mutation response as
// the source of truth across a client-side route transition. It intentionally
// does not persist Recipe data in browser storage.
const pendingRecipes = new Map<string, Recipe>();

export function stageRecipeNavigation(recipe: Recipe): void {
  pendingRecipes.set(recipe.id, recipe);
}

export function takeStagedRecipe(recipeId: string): Recipe | undefined {
  const recipe = pendingRecipes.get(recipeId);
  pendingRecipes.delete(recipeId);
  return recipe;
}
