import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PostPurchaseUseCase } from "./application/post-purchase.use-case";
import { PURCHASE_POSTING_REPOSITORY } from "./application/purchase-posting.repository";
import { PrismaPurchasePostingRepository } from "./infrastructure/prisma-purchase-posting.repository";
import { PrismaPurchaseDraftRepository, PURCHASE_DRAFT_REPOSITORY } from "./infrastructure/purchase-draft.repository";
import { ConfirmPurchaseUseCase, CreatePurchaseDraftUseCase, GetPurchaseUseCase, UpdatePurchaseDraftUseCase } from "./application/purchase-draft.use-cases";
import { PurchaseController } from "./presentation/purchase.controller";
import { ListPurchasesUseCase } from "./application/list-purchases.use-case";
import { PURCHASE_LIST_REPOSITORY } from "./application/purchase-list.repository";
import { PrismaPurchaseListRepository } from "./infrastructure/prisma-purchase-list.repository";
import { PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY } from "./application/recommendation-purchase-handoff.repository";
import { PrismaPurchaseRecommendationHandoffRepository } from "./infrastructure/prisma-recommendation-purchase-handoff.repository";

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseController],
  providers: [
    PostPurchaseUseCase,
    CreatePurchaseDraftUseCase,
    GetPurchaseUseCase,
    UpdatePurchaseDraftUseCase,
    ConfirmPurchaseUseCase,
    ListPurchasesUseCase,
    {
      provide: PURCHASE_POSTING_REPOSITORY,
      useClass: PrismaPurchasePostingRepository,
    },
    { provide: PURCHASE_DRAFT_REPOSITORY, useClass: PrismaPurchaseDraftRepository },
    { provide: PURCHASE_LIST_REPOSITORY, useClass: PrismaPurchaseListRepository },
    { provide: PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY, useClass: PrismaPurchaseRecommendationHandoffRepository },
  ],
})
export class PurchaseModule {}
