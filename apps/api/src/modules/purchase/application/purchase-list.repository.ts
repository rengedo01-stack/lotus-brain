import type { PurchaseStatus } from "../../../generated/prisma/client";

export type PurchaseListSupplierView = {
  code: string;
  name: string;
};

/**
 * Deliberately narrow projection for the operational list. Amounts, line
 * items, notes, and posting-side inventory information remain detail-only.
 */
export type PurchaseListItemView = {
  id: string;
  status: PurchaseStatus;
  purchaseDate: Date;
  documentNumber: string | null;
  postedAt: Date | null;
  cancelledAt: Date | null;
  supplier: PurchaseListSupplierView;
};

export type PurchaseListCursor = {
  purchaseDate: Date;
  id: string;
};

export type ListPurchasesQuery = {
  status?: PurchaseStatus;
  from?: Date;
  to?: Date;
  supplierCode?: string;
  documentNumber?: string;
  limit: number;
  cursor?: PurchaseListCursor;
};

export type PurchaseListPage = {
  items: PurchaseListItemView[];
  nextCursor: PurchaseListCursor | null;
};

export interface PurchaseListRepository {
  list(query: ListPurchasesQuery): Promise<PurchaseListPage>;
}

export const PURCHASE_LIST_REPOSITORY = Symbol("PURCHASE_LIST_REPOSITORY");
