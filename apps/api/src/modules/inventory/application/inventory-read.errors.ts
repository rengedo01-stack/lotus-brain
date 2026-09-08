export class InventoryReadNotFoundError extends Error {
  constructor(productId: string) {
    super(`Inventory record for Product ${productId} was not found.`);
  }
}
