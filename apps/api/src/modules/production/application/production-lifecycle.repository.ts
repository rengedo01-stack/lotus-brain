export type ProductionLifecycleStatus = "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";

export type ProductionCreateInput = {
  recipeId: string;
  productionDate: string;
  plannedQuantity: string;
  note?: string | null;
};

export type ProductionDraftPatchInput = {
  productionDate?: string;
  plannedQuantity?: string;
  note?: string | null;
};

export type ProductionConsumptionView = {
  id: string;
  lineNumber: number;
  productId: string;
  recipeQuantitySnapshot: string;
  recipeUnitId: string;
  inventoryQuantity: string;
  inventoryUnitId: string;
  conversionFactorSnapshot: string;
  unitCostSnapshot: string;
  amountSnapshot: string;
  currency: string;
};

export type ProductionView = {
  id: string;
  recipe: { id: string; rootRecipeId: string; revision: number };
  productionDate: Date;
  plannedQuantity: string;
  actualQuantity: string | null;
  status: ProductionLifecycleStatus;
  note: string | null;
  postedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  output: {
    productId: string;
    yieldQuantity: string;
    unitId: string;
    conversionFactor: string;
  };
  consumptions: ProductionConsumptionView[];
};

export interface ProductionLifecycleRepository {
  create(input: ProductionCreateInput): Promise<ProductionView>;
  get(id: string): Promise<ProductionView | null>;
  updateDraft(id: string, input: ProductionDraftPatchInput): Promise<ProductionView | "NOT_FOUND" | "CONFLICT">;
  confirm(id: string): Promise<ProductionView | "NOT_FOUND" | "CONFLICT">;
}

export const PRODUCTION_LIFECYCLE_REPOSITORY = Symbol("PRODUCTION_LIFECYCLE_REPOSITORY");
