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

/**
 * A read-only projection of the immutable correction ledger. These values are
 * deliberately not reconstructed from current Product, User, Inventory, or
 * PriceMaster state.
 */
export type PurchaseReversalAudit = Readonly<{
  id: string;
  purchaseId: string;
  actorUserId: string;
  reason: string;
  reversedAt: Date;
  items: readonly {
    purchaseItemId: string;
    productId: string;
    inventoryUnitId: string;
    quantity: string;
    unitPrice: string;
    currency: string;
  }[];
  inventoryEffects: readonly {
    productId: string;
    inventoryId: string;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string;
    averageUnitCost: string | null;
  }[];
  priceEffects: readonly {
    priceMasterId: string;
    source: "ORIGINAL_PURCHASE_CURRENT" | "SUBSEQUENT_PRICE_HISTORY_CURRENT" | "LEGACY_UNKNOWN_CURRENT";
    previousCurrentPriceHistoryId: string | null;
    previousVersion: number;
    appliedUnitPrice: string;
    appliedCurrency: string;
    effectiveAt: Date;
    becomesCurrent: boolean;
    priceHistoryId: string;
  }[];
}>;
