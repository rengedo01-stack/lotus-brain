import type { MasterStatus, ProductSupplierPackageStatus, ProductSupplyRelationshipStatus } from "../../../generated/prisma/client";

export type ProductSupplierPackageMasterReference = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  isDeleted: boolean;
};

export type ProductSupplierPackageRelationshipReference = {
  id: string;
  status: ProductSupplyRelationshipStatus;
  version: number;
  product: ProductSupplierPackageMasterReference & {
    inventoryUnit: { code: string; name: string; symbol: string };
  };
  supplier: ProductSupplierPackageMasterReference;
};

export type ProductSupplierPackageView = {
  id: string;
  relationshipId: string;
  code: string;
  name: string;
  inventoryQuantityPerPackage: string;
  isOrderable: boolean;
  status: ProductSupplierPackageStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductSupplierPackagesContextView = {
  relationship: ProductSupplierPackageRelationshipReference;
  packages: ProductSupplierPackageView[];
};

export type ProductSupplierPackageContextView = {
  relationship: ProductSupplierPackageRelationshipReference;
  package: ProductSupplierPackageView;
};

export type ProductSupplierPackageInput = {
  code: string;
  name: string;
  inventoryQuantityPerPackage: string;
  isOrderable: boolean;
  status: ProductSupplierPackageStatus;
};

export type UpdateProductSupplierPackageInput = ProductSupplierPackageInput & { expectedVersion: number };

export interface ProductSupplierPackageRepository {
  list(relationshipId: string): Promise<ProductSupplierPackagesContextView | null>;
  get(relationshipId: string, packageId: string): Promise<ProductSupplierPackageContextView | null>;
  create(relationshipId: string, input: ProductSupplierPackageInput): Promise<ProductSupplierPackageContextView | "NOT_FOUND" | "CONFLICT">;
  update(relationshipId: string, packageId: string, input: UpdateProductSupplierPackageInput): Promise<ProductSupplierPackageContextView | "NOT_FOUND" | "CONFLICT">;
}

export const PRODUCT_SUPPLIER_PACKAGE_REPOSITORY = Symbol("PRODUCT_SUPPLIER_PACKAGE_REPOSITORY");
