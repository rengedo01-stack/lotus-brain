import { Module } from "@nestjs/common";
import { MASTER_REPOSITORY } from "./application/master.repository";
import {
  CreateProductUseCase,
  CreateProductUnitConversionUseCase,
  CreateSupplierUseCase,
  CreateUnitUseCase,
  GetProductUseCase,
  GetProductUnitConversionUseCase,
  GetSupplierUseCase,
  GetUnitUseCase,
  ListProductsUseCase,
  ListProductUnitConversionsUseCase,
  ListSuppliersUseCase,
  ListUnitsUseCase,
  UpdateProductUseCase,
  UpdateSupplierUseCase,
  UpdateUnitUseCase,
} from "./application/master.use-cases";
import { PrismaMasterRepository } from "./infrastructure/prisma-master.repository";
import { MasterController } from "./presentation/master.controller";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [MasterController],
  providers: [
    CreateProductUseCase,
    GetProductUseCase,
    ListProductsUseCase,
    UpdateProductUseCase,
    CreateProductUnitConversionUseCase,
    GetProductUnitConversionUseCase,
    ListProductUnitConversionsUseCase,
    CreateUnitUseCase,
    GetUnitUseCase,
    ListUnitsUseCase,
    UpdateUnitUseCase,
    CreateSupplierUseCase,
    GetSupplierUseCase,
    ListSuppliersUseCase,
    UpdateSupplierUseCase,
    { provide: MASTER_REPOSITORY, useClass: PrismaMasterRepository },
  ],
})
export class MasterModule {}
