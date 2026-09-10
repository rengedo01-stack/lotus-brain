import { Inject, Injectable } from "@nestjs/common";
import { MasterConflictError, MasterNotFoundError } from "./master.errors";
import {
  PRODUCT_SUPPLIER_PACKAGE_REPOSITORY,
  type ProductSupplierPackageInput,
  type ProductSupplierPackageRepository,
  type UpdateProductSupplierPackageInput,
} from "./product-supplier-package.repository";

@Injectable()
export class ListProductSupplierPackagesUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_PACKAGE_REPOSITORY) private readonly repository: ProductSupplierPackageRepository) {}

  async execute(relationshipId: string) {
    const context = await this.repository.list(relationshipId);
    if (context === null) throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    return context;
  }
}

@Injectable()
export class GetProductSupplierPackageUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_PACKAGE_REPOSITORY) private readonly repository: ProductSupplierPackageRepository) {}

  async execute(relationshipId: string, packageId: string) {
    const context = await this.repository.get(relationshipId, packageId);
    if (context === null) throw new MasterNotFoundError("ProductSupplierPackage", packageId);
    return context;
  }
}

@Injectable()
export class CreateProductSupplierPackageUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_PACKAGE_REPOSITORY) private readonly repository: ProductSupplierPackageRepository) {}

  async execute(relationshipId: string, input: ProductSupplierPackageInput) {
    const result = await this.repository.create(relationshipId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplyRelationship", relationshipId);
    if (result === "CONFLICT") throw new MasterConflictError("A package with this code already exists or the supply relationship changed. Reload before editing again.");
    return result;
  }
}

@Injectable()
export class UpdateProductSupplierPackageUseCase {
  constructor(@Inject(PRODUCT_SUPPLIER_PACKAGE_REPOSITORY) private readonly repository: ProductSupplierPackageRepository) {}

  async execute(relationshipId: string, packageId: string, input: UpdateProductSupplierPackageInput) {
    const result = await this.repository.update(relationshipId, packageId, input);
    if (result === "NOT_FOUND") throw new MasterNotFoundError("ProductSupplierPackage", packageId);
    if (result === "CONFLICT") throw new MasterConflictError("The package or supply relationship changed. Reload before editing again.");
    return result;
  }
}
