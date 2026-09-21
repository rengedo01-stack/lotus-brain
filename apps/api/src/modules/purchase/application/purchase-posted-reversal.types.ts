export type PriceResolutionInput = Readonly<{
  productId: string;
  expectedPriceMasterVersion: number;
  currentUnitPrice: string;
  currency: string;
}>;

export type PurchaseReversalPreview = Readonly<{
  purchaseId: string;
  canReverse: boolean;
  refusalReasons: readonly string[];
  previewVersion: string;
  existingReversal: { id: string; reversedAt: Date } | null;
  inventoryEffects: readonly {
    productId: string;
    inventoryId: string | null;
    inventoryVersion: number | null;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string | null;
    averageUnitCost: string | null;
  }[];
  priceEffects: readonly {
    productId: string;
    priceMasterId: string | null;
    version: number | null;
    currentPriceHistoryId: string | null;
    currentUnitPrice: string | null;
    currency: string | null;
    source: "ORIGINAL_PURCHASE_CURRENT" | "SUBSEQUENT_PRICE_HISTORY_CURRENT" | "LEGACY_UNKNOWN_CURRENT" | "MISSING_PRICE_MASTER";
    requiresPriceResolution: boolean;
  }[];
}>;

export type PurchaseReversalExecution = Readonly<{
  id: string;
  purchaseId: string;
  reversedAt: Date;
  replayed: boolean;
}>;
