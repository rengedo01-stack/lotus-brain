import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { ListCurrentInventoryUseCase, ListInventoryHistoryUseCase } from "./application/inventory-read.use-cases";
import { INVENTORY_READ_REPOSITORY } from "./application/inventory-read.repository";
import { PrismaInventoryReadRepository } from "./infrastructure/prisma-inventory-read.repository";
import { InventoryController } from "./presentation/inventory.controller";

@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [
    ListCurrentInventoryUseCase,
    ListInventoryHistoryUseCase,
    { provide: INVENTORY_READ_REPOSITORY, useClass: PrismaInventoryReadRepository },
  ],
})
export class InventoryModule {}
