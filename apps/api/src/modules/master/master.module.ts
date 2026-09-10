import { Module } from "@nestjs/common";
import { MASTER_REPOSITORY } from "./application/master.repository";
import {
  CreateProductUseCase,
  CreateProductSupplyRelationshipUseCase,
  CreateProductUnitConversionUseCase,
  CreateSupplierUseCase,
  CreateUnitUseCase,
  GetProductUseCase,
  GetProductSupplyRelationshipUseCase,
  GetProductUnitConversionUseCase,
  GetSupplierUseCase,
  GetUnitUseCase,
  ListProductsUseCase,
  ListProductSupplyRelationshipsUseCase,
  ListProductUnitConversionsUseCase,
  ListSuppliersUseCase,
  ListUnitsUseCase,
  UpdateProductUseCase,
  UpdateProductSupplyRelationshipUseCase,
  UpdateSupplierUseCase,
  UpdateUnitUseCase,
} from "./application/master.use-cases";
import { PrismaMasterRepository } from "./infrastructure/prisma-master.repository";
import { MasterController } from "./presentation/master.controller";
import { ProductSupplyRelationshipController } from "./presentation/product-supply-relationship.controller";
import { PrismaModule } from "../../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [MasterController, ProductSupplyRelationshipController],
  providers: [
    CreateProductUseCase,
    CreateProductSupplyRelationshipUseCase,
    GetProductUseCase,
    GetProductSupplyRelationshipUseCase,
    ListProductsUseCase,
    ListProductSupplyRelationshipsUseCase,
    UpdateProductUseCase,
    UpdateProductSupplyRelationshipUseCase,
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
