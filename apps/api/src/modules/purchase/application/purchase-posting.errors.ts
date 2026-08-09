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
