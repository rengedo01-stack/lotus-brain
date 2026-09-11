export class ReplenishmentQuantityPreviewNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product ${productId} was not found.`);
    this.name = "ReplenishmentQuantityPreviewNotFoundError";
  }
}
