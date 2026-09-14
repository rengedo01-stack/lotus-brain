import { Inject, Injectable } from "@nestjs/common";
import {
  PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY,
  type PurchaseRecommendationHandoffRepository,
  type RecommendationPurchaseDraftHandoffResult,
} from "./recommendation-purchase-handoff.repository";
import {
  RecommendationPurchaseHandoffConflictError,
  RecommendationPurchaseHandoffNotFoundError,
} from "./recommendation-purchase-handoff.errors";

@Injectable()
export class CreateRecommendationPurchaseDraftUseCase {
  constructor(@Inject(PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY) private readonly repository: PurchaseRecommendationHandoffRepository) {}

  async execute(recommendationId: string, purchaseDate: Date): Promise<RecommendationPurchaseDraftHandoffResult> {
    const result = await this.repository.createPurchaseDraft({ sourceRecommendationId: recommendationId, purchaseDate });
    if (result === "NOT_FOUND") throw new RecommendationPurchaseHandoffNotFoundError(`Recommendation ${recommendationId} was not found.`);
    if (result === "CONFLICT") throw new RecommendationPurchaseHandoffConflictError("The Recommendation is not currently eligible for Purchase draft handoff.");
    return result;
  }
}
