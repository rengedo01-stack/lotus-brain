import { Inject, Injectable } from "@nestjs/common";
import {
  PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY,
  type PurchaseRecommendationHandoffRepository,
  type PurchaseRecommendationHandoffLineage,
} from "./recommendation-purchase-handoff.repository";
import { PurchaseRecommendationHandoffLineageNotFoundError } from "./recommendation-purchase-handoff.errors";

@Injectable()
export class GetPurchaseHandoffLineageUseCase {
  constructor(@Inject(PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY) private readonly repository: PurchaseRecommendationHandoffRepository) {}

  async execute(purchaseId: string): Promise<PurchaseRecommendationHandoffLineage[]> {
    const result = await this.repository.getLineagesByPurchaseId(purchaseId);
    if (result === "NOT_FOUND") throw new PurchaseRecommendationHandoffLineageNotFoundError(`Purchase ${purchaseId} was not found.`);
    return result;
  }
}
