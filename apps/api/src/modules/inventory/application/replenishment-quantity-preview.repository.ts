export const REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY = Symbol("REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY");

export type ReplenishmentPreviewUnitView = {
  code: string;
  name: string;
  symbol: string;
};

export type ReplenishmentPreviewProductView = {
  id: string;
  code: string;
  name: string;
};

export type PreferredSupplierView = {
  relationshipId: string;
  supplier: { id: string; code: string; name: string };
  isEligible: boolean;
};

export type OrderingTermsView = {
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
};

export type PreferredPackageView = {
  id: string;
  code: string;
  name: string;
  inventoryQuantityPerPackage: string;
  isEligible: boolean;
};

export type ReplenishmentQuantityPreviewStatus =
  | "READY"
  | "TARGET_NOT_CONFIGURED"
  | "NO_POSITIVE_NEED"
  | "INVENTORY_RECONCILIATION_REQUIRED"
  | "NO_PREFERRED_SUPPLIER"
  | "PREFERRED_SUPPLIER_INELIGIBLE"
  | "PREFERRED_PACKAGE_INELIGIBLE"
  | "CONSTRAINT_UNREPRESENTABLE"
  | "NOT_A_REPLENISHMENT_CANDIDATE";

export type ReplenishmentQuantityPreviewReady = {
  status: "READY";
  rawTargetGap: string;
  feasibleQuantity: string;
  overOrderQuantity: string;
  packageCount: string | null;
};

export type ReplenishmentQuantityPreviewBlocked = {
  status: Exclude<ReplenishmentQuantityPreviewStatus, "READY">;
  rawTargetGap: string | null;
  feasibleQuantity: null;
  overOrderQuantity: null;
  packageCount: null;
};

export type ReplenishmentQuantityPreviewResult =
  | ReplenishmentQuantityPreviewReady
  | ReplenishmentQuantityPreviewBlocked;

/**
 * This is a read-only explanation of the current master and inventory facts.
 * It is not a persisted recommendation and never creates a Purchase.
 */
export type ReplenishmentQuantityPreviewView = {
  product: ReplenishmentPreviewProductView;
  inventoryUnit: ReplenishmentPreviewUnitView;
  currentQuantity: string | null;
  reorderPointQuantity: string | null;
  targetStockQuantity: string | null;
  draftPurchaseQuantity: string | null;
  confirmedPurchaseQuantity: string | null;
  preferredSupplier: PreferredSupplierView | null;
  orderingTerms: OrderingTermsView | null;
  preferredPackage: PreferredPackageView | null;
  result: ReplenishmentQuantityPreviewResult;
};

export interface ReplenishmentQuantityPreviewRepository {
  get(productId: string): Promise<ReplenishmentQuantityPreviewView | null>;
}
