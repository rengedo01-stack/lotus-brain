export type StocktakeStatus = "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";
export type InventoryAdjustmentStatus = "DRAFT" | "POSTED" | "CANCELLED";
export type InventoryAdjustmentReason =
  | "STOCKTAKE_DIFFERENCE"
  | "SHRINKAGE"
  | "DAMAGE"
  | "ROUNDING"
  | "OTHER";

export type StocktakeItemInput = {
  productId: string;
  countedQuantity?: string | null;
  note?: string | null;
};

export type StocktakeInput = {
  note?: string | null;
  items: StocktakeItemInput[];
};

export type StocktakeItemView = {
  id: string;
  productId: string;
  inventoryUnitId: string;
  systemQuantitySnapshot: string | null;
  countedQuantity: string | null;
  differenceQuantity: string | null;
  note: string | null;
};

export type StocktakeView = {
  id: string;
  status: StocktakeStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: StocktakeItemView[];
};

export type StocktakePostingResult = {
  id: string;
  status: "POSTED";
  completedAt: Date;
};

export type StocktakePostingTransaction = {
  lockStocktakeItems(stocktakeId: string): Promise<Array<{
    id: string;
    productId: string;
    inventoryUnitId: string;
    systemQuantitySnapshot: string | null;
    countedQuantity: string | null;
    differenceQuantity: string | null;
    note: string | null;
  }>>;
  lockInventories(productIds: string[]): Promise<Array<{ id: string; productId: string; quantity: string; averageUnitCost: string | null; inventoryUnitId: string }>>;
  lockStocktake(stocktakeId: string): Promise<StocktakeView | null>;
  createAdjustment(stocktakeId: string, postedAt: Date, note: string | null): Promise<string>;
  createAdjustmentItems(adjustmentId: string, items: Array<{
    stocktakeItemId: string;
    productId: string;
    inventoryId: string;
    inventoryUnitId: string;
    quantityDelta: string;
    reason: InventoryAdjustmentReason;
    note: string | null;
  }>): Promise<Array<{ stocktakeItemId: string; adjustmentItemId: string }>>;
  updateInventories(updates: Array<{ inventoryId: string; quantity: string }>): Promise<void>;
  markStocktakePosted(stocktakeId: string, completedAt: Date): Promise<void>;
  createInventoryHistories(entries: Array<{
    inventoryId: string;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string;
    sourceInventoryAdjustmentItemId: string;
  }>): Promise<void>;
};

export interface StocktakeRepository {
  create(input: StocktakeInput): Promise<StocktakeView>;
  get(id: string): Promise<StocktakeView | null>;
  updateDraft(id: string, input: StocktakeInput): Promise<StocktakeView | "NOT_FOUND" | "CONFLICT">;
  confirm(id: string): Promise<StocktakeView | "NOT_FOUND" | "CONFLICT">;
  withTransaction<T>(operation: (transaction: StocktakePostingTransaction) => Promise<T>): Promise<T>;
}

export const STOCKTAKE_REPOSITORY = Symbol("STOCKTAKE_REPOSITORY");
