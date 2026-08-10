export class PurchaseNotFoundError extends Error {
  constructor(purchaseId: string) {
    super(`Purchase ${purchaseId} was not found.`);
  }
}

export class PurchasePostingConflictError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class InvalidPurchaseItemError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class InventoryValuationUnavailableError extends Error {
  constructor(productId: string) {
    super(
      `Inventory valuation for product ${productId} is unavailable because it has quantity without an average unit cost.`,
    );
  }
}
