import { Inject, Injectable } from "@nestjs/common";
import {
  PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY,
  type PurchaseRecommendationHandoffRepository,
  type RecommendationPurchaseHandoffLineage,
} from "./recommendation-purchase-handoff.repository";
import { RecommendationPurchaseHandoffNotFoundError } from "./recommendation-purchase-handoff.errors";

@Injectable()
export class GetRecommendationPurchaseHandoffUseCase {
  constructor(@Inject(PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY) private readonly repository: PurchaseRecommendationHandoffRepository) {}

  async execute(recommendationId: string): Promise<RecommendationPurchaseHandoffLineage | null> {
    const result = await this.repository.getLineageBySourceRecommendationId(recommendationId);
    if (result === "NOT_FOUND") throw new RecommendationPurchaseHandoffNotFoundError(`Recommendation ${recommendationId} was not found.`);
    return result;
  }
}
