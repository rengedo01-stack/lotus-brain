import { Inject, Injectable } from "@nestjs/common";
import {
  REPLENISHMENT_RECOMMENDATION_REPOSITORY,
  type ReplenishmentRecommendationRepository,
} from "./replenishment-recommendation.repository";
import { ReplenishmentRecommendationConflictError, ReplenishmentRecommendationNotFoundError } from "./replenishment-recommendation.errors";

@Injectable()
export class GetActiveReplenishmentRecommendationUseCase {
  constructor(@Inject(REPLENISHMENT_RECOMMENDATION_REPOSITORY) private readonly repository: ReplenishmentRecommendationRepository) {}

  async execute(productId: string) {
    return { recommendation: await this.repository.getActive(productId) };
  }
}

@Injectable()
export class RecalculateReplenishmentRecommendationUseCase {
  constructor(@Inject(REPLENISHMENT_RECOMMENDATION_REPOSITORY) private readonly repository: ReplenishmentRecommendationRepository) {}

  async execute(productId: string, actorUserId: string) {
    const result = await this.repository.recalculate(productId, actorUserId);
    if (result === "NOT_FOUND") throw new ReplenishmentRecommendationNotFoundError(productId);
    if (result === "NOT_READY") {
      throw new ReplenishmentRecommendationConflictError("The current replenishment preview is not READY, so no recommendation snapshot was created.");
    }
    return { recommendation: result };
  }
}

@Injectable()
export class DismissReplenishmentRecommendationUseCase {
  constructor(@Inject(REPLENISHMENT_RECOMMENDATION_REPOSITORY) private readonly repository: ReplenishmentRecommendationRepository) {}

  async execute(productId: string, recommendationId: string, expectedVersion: number, actorUserId: string) {
    const result = await this.repository.dismiss(productId, recommendationId, expectedVersion, actorUserId);
    if (result === "NOT_FOUND") throw new ReplenishmentRecommendationNotFoundError(recommendationId);
    if (result === "CONFLICT") throw new ReplenishmentRecommendationConflictError();
    return { recommendation: result };
  }
}
