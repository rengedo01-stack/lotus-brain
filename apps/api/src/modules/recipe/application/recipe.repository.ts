export type RecipeStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type RecipeItemInput = {
  productId: string;
  unitId: string;
  quantity: string;
};

export type RecipeDraftInput = {
  name: string;
  outputProductId: string;
  yieldQuantity: string;
  yieldUnitId: string;
  note?: string | null;
  items: RecipeItemInput[];
};

export type RecipeItemView = RecipeItemInput & {
  id: string;
  sortOrder: number;
};

export type RecipeView = {
  id: string;
  rootRecipeId: string;
  name: string;
  outputProductId: string;
  yieldQuantity: string;
  yieldUnitId: string;
  status: RecipeStatus;
  revision: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: RecipeItemView[];
};

export type RecipeListQuery = {
  limit: number;
  offset: number;
  status?: RecipeStatus;
};

export interface RecipeRepository {
  createDraft(input: RecipeDraftInput): Promise<RecipeView>;
  get(id: string): Promise<RecipeView | null>;
  list(query: RecipeListQuery): Promise<RecipeView[]>;
  updateDraft(id: string, input: RecipeDraftInput): Promise<RecipeView | "NOT_FOUND" | "CONFLICT">;
  activate(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT">;
  archive(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT">;
  createRevision(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT">;
}

export const RECIPE_REPOSITORY = Symbol("RECIPE_REPOSITORY");
