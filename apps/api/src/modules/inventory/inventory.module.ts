import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ListCurrentInventoryUseCase, ListInventoryHistoryUseCase, ListInventorySupplyContextUseCase, ListReplenishmentCandidatesUseCase } from "./application/inventory-read.use-cases";
import { INVENTORY_READ_REPOSITORY } from "./application/inventory-read.repository";
import { GetReplenishmentQuantityPreviewUseCase } from "./application/replenishment-quantity-preview.use-case";
import { REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY } from "./application/replenishment-quantity-preview.repository";
import { PrismaInventoryReadRepository } from "./infrastructure/prisma-inventory-read.repository";
import { PrismaReplenishmentQuantityPreviewRepository } from "./infrastructure/prisma-replenishment-quantity-preview.repository";
import { InventoryController } from "./presentation/inventory.controller";

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [
    ListCurrentInventoryUseCase,
    ListInventorySupplyContextUseCase,
    ListReplenishmentCandidatesUseCase,
    ListInventoryHistoryUseCase,
    GetReplenishmentQuantityPreviewUseCase,
    { provide: INVENTORY_READ_REPOSITORY, useClass: PrismaInventoryReadRepository },
    { provide: REPLENISHMENT_QUANTITY_PREVIEW_REPOSITORY, useClass: PrismaReplenishmentQuantityPreviewRepository },
  ],
})
export class InventoryModule {}
