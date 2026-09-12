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
import {
  CreateProductSupplierOrderingTermsUseCase,
  GetProductSupplierOrderingTermsUseCase,
  ListProductSupplierOrderingTermsUseCase,
  UpdateProductSupplierOrderingTermsUseCase,
} from "./application/product-supplier-ordering-terms.use-cases";
import {
  ClearProductSupplierCommercialTermsUseCase,
  CreateProductSupplierCommercialTermsUseCase,
  GetProductSupplierCommercialTermsUseCase,
  UpdateProductSupplierCommercialTermsUseCase,
} from "./application/product-supplier-commercial-terms.use-cases";
import {
  CreateProductSupplierPackageUseCase,
  GetProductSupplierPackageUseCase,
  ListProductSupplierPackagesUseCase,
  UpdateProductSupplierPackageUseCase,
} from "./application/product-supplier-package.use-cases";
import { PrismaMasterRepository } from "./infrastructure/prisma-master.repository";
import { PrismaProductSupplierOrderingTermsRepository } from "./infrastructure/prisma-product-supplier-ordering-terms.repository";
import { PrismaProductSupplierCommercialTermsRepository } from "./infrastructure/prisma-product-supplier-commercial-terms.repository";
import { PrismaProductSupplierPackageRepository } from "./infrastructure/prisma-product-supplier-package.repository";
import { MasterController } from "./presentation/master.controller";
import { ProductSupplyRelationshipController } from "./presentation/product-supply-relationship.controller";
import { ProductSupplierOrderingTermsController } from "./presentation/product-supplier-ordering-terms.controller";
import { ProductSupplierCommercialTermsController } from "./presentation/product-supplier-commercial-terms.controller";
import { ProductSupplierPackageController } from "./presentation/product-supplier-package.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY } from "./application/product-supplier-ordering-terms.repository";
import { PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY } from "./application/product-supplier-commercial-terms.repository";
import { PRODUCT_SUPPLIER_PACKAGE_REPOSITORY } from "./application/product-supplier-package.repository";
import { PRODUCT_SUPPLY_PREFERENCE_REPOSITORY } from "./application/product-supply-preference.repository";
import { ProductSupplyPreferenceUseCases } from "./application/product-supply-preference.use-cases";
import { PrismaProductSupplyPreferenceRepository } from "./infrastructure/prisma-product-supply-preference.repository";
import { ProductSupplyPreferenceController } from "./presentation/product-supply-preference.controller";

@Module({
  imports: [PrismaModule],
  // Register the static /ordering-terms collection route before C8's dynamic
  // /:id relationship route.
  controllers: [MasterController, ProductSupplyPreferenceController, ProductSupplierOrderingTermsController, ProductSupplierCommercialTermsController, ProductSupplierPackageController, ProductSupplyRelationshipController],
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
    CreateProductSupplierOrderingTermsUseCase,
    GetProductSupplierOrderingTermsUseCase,
    ListProductSupplierOrderingTermsUseCase,
    UpdateProductSupplierOrderingTermsUseCase,
    CreateProductSupplierCommercialTermsUseCase,
    GetProductSupplierCommercialTermsUseCase,
    UpdateProductSupplierCommercialTermsUseCase,
    ClearProductSupplierCommercialTermsUseCase,
    CreateProductSupplierPackageUseCase,
    GetProductSupplierPackageUseCase,
    ListProductSupplierPackagesUseCase,
    UpdateProductSupplierPackageUseCase,
    ProductSupplyPreferenceUseCases,
    { provide: MASTER_REPOSITORY, useClass: PrismaMasterRepository },
    { provide: PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY, useClass: PrismaProductSupplierOrderingTermsRepository },
    { provide: PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY, useClass: PrismaProductSupplierCommercialTermsRepository },
    { provide: PRODUCT_SUPPLIER_PACKAGE_REPOSITORY, useClass: PrismaProductSupplierPackageRepository },
    { provide: PRODUCT_SUPPLY_PREFERENCE_REPOSITORY, useClass: PrismaProductSupplyPreferenceRepository },
  ],
})
export class MasterModule {}
