import type { InventoryTransactionType, MasterStatus } from "../../../generated/prisma/client";

export type InventoryUnitView = {
  code: string;
  name: string;
  symbol: string;
};

export type InventoryProductView = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  isDeleted: boolean;
};

export type CurrentInventoryView = {
  product: InventoryProductView;
  quantity: string;
  inventoryUnit: InventoryUnitView;
  updatedAt: Date;
};

export type InventoryHistoryView = {
  id: string;
  type: InventoryTransactionType;
  quantityDelta: string;
  quantityAfter: string;
  occurredAt: Date;
  inventoryUnit: InventoryUnitView;
};

export type CurrentInventoryCursor = {
  productCode: string;
  productId: string;
};

export type InventoryHistoryCursor = {
  occurredAt: Date;
  id: string;
};

export type ListCurrentInventoryQuery = {
  productCode?: string;
  limit: number;
  cursor?: CurrentInventoryCursor;
};

export type ListInventoryHistoryQuery = {
  productId: string;
  type?: InventoryTransactionType;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: InventoryHistoryCursor;
};

export type CurrentInventoryPage = {
  items: CurrentInventoryView[];
  nextCursor: CurrentInventoryCursor | null;
};

/**
 * These figures deliberately remain independent facts. In particular, neither
 * pending purchase quantity is an expected receipt or an available-inventory
 * calculation.
 */
export type InventorySupplyContextView = {
  product: Pick<InventoryProductView, "id" | "code" | "name">;
  inventoryUnit: InventoryUnitView;
  currentQuantity: string;
  draftPurchaseQuantity: string;
  confirmedPurchaseQuantity: string;
};

export type InventorySupplyContextPage = {
  items: InventorySupplyContextView[];
  nextCursor: CurrentInventoryCursor | null;
};

/**
 * A replenishment candidate is deliberately a narrow observation, not an
 * order recommendation. The two purchase quantities remain independent facts
 * and never participate in the candidate predicate.
 */
export type ReplenishmentCandidateView = {
  product: Pick<InventoryProductView, "id" | "code" | "name">;
  inventoryUnit: InventoryUnitView;
  currentQuantity: string;
  reorderPointQuantity: string;
  draftPurchaseQuantity: string;
  confirmedPurchaseQuantity: string;
};

export type ReplenishmentCandidatePage = {
  items: ReplenishmentCandidateView[];
  nextCursor: CurrentInventoryCursor | null;
};

export type InventoryHistoryPage = {
  currentInventory: CurrentInventoryView;
  items: InventoryHistoryView[];
  nextCursor: InventoryHistoryCursor | null;
};

export interface InventoryReadRepository {
  listCurrentInventory(query: ListCurrentInventoryQuery): Promise<CurrentInventoryPage>;
  listSupplyContext(query: ListCurrentInventoryQuery): Promise<InventorySupplyContextPage>;
  listReplenishmentCandidates(query: ListCurrentInventoryQuery): Promise<ReplenishmentCandidatePage>;
  listInventoryHistory(query: ListInventoryHistoryQuery): Promise<InventoryHistoryPage | null>;
}

export const INVENTORY_READ_REPOSITORY = Symbol("INVENTORY_READ_REPOSITORY");
