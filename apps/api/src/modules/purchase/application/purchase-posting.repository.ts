export type PurchasePostingStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "POSTED"
  | "CANCELLED";

export type PurchaseItemForPosting = {
  id: string;
  productId: string;
  unitId: string;
  inventoryUnitId: string;
  lineNumber: number;
  quantity: string;
  unitPrice: string;
};

export type PurchaseForPosting = {
  id: string;
  supplierId: string;
  purchaseDate: Date;
  currency: string;
  status: PurchasePostingStatus;
  items: PurchaseItemForPosting[];
};

export type PostedPurchase = {
  id: string;
  status: "POSTED";
  postedAt: Date;
};

export interface PurchasePostingTransaction {
  lockPurchase(purchaseId: string): Promise<PurchaseForPosting | null>;
  writePriceEffect(
    purchase: PurchaseForPosting,
    item: PurchaseItemForPosting,
  ): Promise<void>;
  markPurchasePosted(purchaseId: string, postedAt: Date): Promise<void>;
  writeInventoryEffect(
    purchase: PurchaseForPosting,
    item: PurchaseItemForPosting,
  ): Promise<void>;
  appendPostedLog(
    purchaseId: string,
    fromStatus: PurchasePostingStatus,
    occurredAt: Date,
  ): Promise<void>;
}

export interface PurchasePostingRepository {
  withTransaction<T>(
    operation: (transaction: PurchasePostingTransaction) => Promise<T>,
  ): Promise<T>;
}

export const PURCHASE_POSTING_REPOSITORY = Symbol("PURCHASE_POSTING_REPOSITORY");
