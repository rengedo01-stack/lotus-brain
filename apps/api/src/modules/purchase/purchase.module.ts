import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PostPurchaseUseCase } from "./application/post-purchase.use-case";
import { PURCHASE_POSTING_REPOSITORY } from "./application/purchase-posting.repository";
import { PrismaPurchasePostingRepository } from "./infrastructure/prisma-purchase-posting.repository";
import { PurchaseController } from "./presentation/purchase.controller";

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseController],
  providers: [
    PostPurchaseUseCase,
    {
      provide: PURCHASE_POSTING_REPOSITORY,
      useClass: PrismaPurchasePostingRepository,
    },
  ],
})
export class PurchaseModule {}
