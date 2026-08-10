import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PostPurchaseUseCase } from "./application/post-purchase.use-case";
import { PURCHASE_POSTING_REPOSITORY } from "./application/purchase-posting.repository";
import { PrismaPurchasePostingRepository } from "./infrastructure/prisma-purchase-posting.repository";
import { PrismaPurchaseDraftRepository, PURCHASE_DRAFT_REPOSITORY } from "./infrastructure/purchase-draft.repository";
import { ConfirmPurchaseUseCase, CreatePurchaseDraftUseCase, GetPurchaseUseCase, UpdatePurchaseDraftUseCase } from "./application/purchase-draft.use-cases";
import { PurchaseController } from "./presentation/purchase.controller";

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseController],
  providers: [
    PostPurchaseUseCase,
    CreatePurchaseDraftUseCase,
    GetPurchaseUseCase,
    UpdatePurchaseDraftUseCase,
    ConfirmPurchaseUseCase,
    {
      provide: PURCHASE_POSTING_REPOSITORY,
      useClass: PrismaPurchasePostingRepository,
    },
    { provide: PURCHASE_DRAFT_REPOSITORY, useClass: PrismaPurchaseDraftRepository },
  ],
})
export class PurchaseModule {}
