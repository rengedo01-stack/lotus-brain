import { Inject, Injectable } from "@nestjs/common";
import {
  InvalidPurchaseItemError,
  PurchaseNotFoundError,
  PurchasePostingConflictError,
} from "./purchase-posting.errors";
import {
  PURCHASE_POSTING_REPOSITORY,
  type PostedPurchase,
  type PurchaseItemForPosting,
  type PurchasePostingRepository,
} from "./purchase-posting.repository";

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

@Injectable()
export class PostPurchaseUseCase {
  constructor(
    @Inject(PURCHASE_POSTING_REPOSITORY)
    private readonly repository: PurchasePostingRepository,
  ) {}

  async execute(purchaseId: string): Promise<PostedPurchase> {
    return this.repository.withTransaction(async (transaction) => {
      const purchase = await transaction.lockPurchase(purchaseId);

      if (purchase === null) {
        throw new PurchaseNotFoundError(purchaseId);
      }

      if (purchase.status === "POSTED" || purchase.status === "CANCELLED") {
        throw new PurchasePostingConflictError(
          `Purchase ${purchase.id} cannot be posted from ${purchase.status}.`,
        );
      }

      if (purchase.items.length === 0) {
        throw new InvalidPurchaseItemError("A purchase must have at least one item.");
      }

      for (const item of purchase.items) {
        this.assertItemIsPostable(item);
        await transaction.writePriceEffect(purchase, item);
      }

      const postedAt = new Date();

      // The database receipt trigger requires the parent purchase to be POSTED.
      // This remains atomic because the surrounding interactive transaction rolls
      // this state change back if a later inventory or log write fails.
      await transaction.markPurchasePosted(purchase.id, postedAt);

      for (const item of purchase.items) {
        await transaction.writeInventoryEffect(purchase, item);
      }

      await transaction.appendPostedLog(purchase.id, purchase.status, postedAt);

      return { id: purchase.id, status: "POSTED", postedAt };
    });
  }

  private assertItemIsPostable(item: PurchaseItemForPosting): void {
    if (item.unitId !== item.inventoryUnitId) {
      throw new InvalidPurchaseItemError(
        `Purchase item ${item.id} must use the product inventory unit.`,
      );
    }

    if (!this.isPositiveDecimal(item.quantity)) {
      throw new InvalidPurchaseItemError(
        `Purchase item ${item.id} must have a positive quantity.`,
      );
    }

    if (!this.isNonNegativeDecimal(item.unitPrice)) {
      throw new InvalidPurchaseItemError(
        `Purchase item ${item.id} must have a non-negative unit price.`,
      );
    }
  }

  private isPositiveDecimal(value: string): boolean {
    return this.isNonNegativeDecimal(value) && !/^0(?:\.0+)?$/.test(value);
  }

  private isNonNegativeDecimal(value: string): boolean {
    return DECIMAL_PATTERN.test(value);
  }
}
