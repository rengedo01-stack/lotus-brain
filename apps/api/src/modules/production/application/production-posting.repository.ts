export type ProductionPostingStatus = "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";

export type ProductionConsumptionForPosting = {
  id: string;
  productId: string;
  recipeQuantitySnapshot: string;
  recipeUnitId: string;
  inventoryUnitId: string;
  conversionFactorSnapshot: string;
};

export type ProductionForPosting = {
  id: string;
  status: ProductionPostingStatus;
  outputProductIdSnapshot: string;
  outputUnitIdSnapshot: string;
  outputConversionFactorSnapshot: string;
  yieldQuantitySnapshot: string;
  consumptions: ProductionConsumptionForPosting[];
};

export type LockedInventory = {
  id: string;
  productId: string;
  quantity: string;
  averageUnitCost: string | null;
  inventoryUnitId: string;
};

export interface ProductionPostingTransaction {
  lockProduction(id: string): Promise<ProductionForPosting | null>;
  lockInventories(productIds: string[]): Promise<LockedInventory[]>;
  lockProductionStatus(id: string): Promise<ProductionPostingStatus | null>;
  updateConsumptionCost(id: string, recipeQuantity: string, inventoryQuantity: string, unitCost: string, amount: string): Promise<void>;
  markProductionPosted(id: string, actualQuantity: string, postedAt: Date): Promise<void>;
  updateInventory(id: string, quantity: string, averageUnitCost: string | null): Promise<void>;
  createConsumptionHistory(consumptionId: string, inventory: LockedInventory, quantity: string, quantityAfter: string): Promise<void>;
  createOutputHistory(productionId: string, inventory: LockedInventory, quantity: string, quantityAfter: string): Promise<void>;
  appendPostedLog(productionId: string, occurredAt: Date): Promise<void>;
}

export interface ProductionPostingRepository {
  withTransaction<T>(operation: (transaction: ProductionPostingTransaction) => Promise<T>): Promise<T>;
}

export const PRODUCTION_POSTING_REPOSITORY = Symbol("PRODUCTION_POSTING_REPOSITORY");
