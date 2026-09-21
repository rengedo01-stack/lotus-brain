import { Injectable } from "@nestjs/common";
import { PrismaPurchasePostedReversalRepository } from "../infrastructure/prisma-purchase-posted-reversal.repository";
import type { PriceResolutionInput, PurchaseReversalExecution, PurchaseReversalPreview } from "./purchase-posted-reversal.types";

@Injectable()
export class PurchasePostedReversalService {
  constructor(private readonly repository: PrismaPurchasePostedReversalRepository) {}

  preview(purchaseId: string): Promise<PurchaseReversalPreview> {
    return this.repository.preview(purchaseId);
  }

  execute(input: {
    purchaseId: string;
    actorUserId: string;
    reason: string;
    previewVersion: string;
    idempotencyKey: string;
    priceResolutions: readonly PriceResolutionInput[];
  }): Promise<PurchaseReversalExecution> {
    return this.repository.execute(input);
  }
}
