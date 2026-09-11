import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CreateReplenishmentPolicyUseCase, GetReplenishmentPolicyUseCase, UpdateReplenishmentPolicyUseCase } from "./application/replenishment-policy.use-cases";
import { REPLENISHMENT_POLICY_REPOSITORY } from "./application/replenishment-policy.repository";
import { PrismaReplenishmentPolicyRepository } from "./infrastructure/prisma-replenishment-policy.repository";
import { PrismaReplenishmentRecommendationRepository } from "./infrastructure/prisma-replenishment-recommendation.repository";
import { ReplenishmentPolicyController } from "./presentation/replenishment-policy.controller";
import { ReplenishmentRecommendationController } from "./presentation/replenishment-recommendation.controller";
import { DismissReplenishmentRecommendationUseCase, GetActiveReplenishmentRecommendationUseCase, RecalculateReplenishmentRecommendationUseCase } from "./application/replenishment-recommendation.use-cases";
import { REPLENISHMENT_RECOMMENDATION_REPOSITORY } from "./application/replenishment-recommendation.repository";

@Module({
  imports: [PrismaModule],
  controllers: [ReplenishmentPolicyController, ReplenishmentRecommendationController],
  providers: [
    GetReplenishmentPolicyUseCase,
    CreateReplenishmentPolicyUseCase,
    UpdateReplenishmentPolicyUseCase,
    GetActiveReplenishmentRecommendationUseCase,
    RecalculateReplenishmentRecommendationUseCase,
    DismissReplenishmentRecommendationUseCase,
    { provide: REPLENISHMENT_POLICY_REPOSITORY, useClass: PrismaReplenishmentPolicyRepository },
    { provide: REPLENISHMENT_RECOMMENDATION_REPOSITORY, useClass: PrismaReplenishmentRecommendationRepository },
  ],
})
export class ReplenishmentPolicyModule {}
