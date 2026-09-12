import type { MasterStatus, ProductSupplyRelationshipStatus } from "../../../generated/prisma/client";

export type CommercialTermsMasterReference = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  isDeleted: boolean;
};

export type CommercialTermsRelationshipReference = {
  id: string;
  status: ProductSupplyRelationshipStatus;
  version: number;
  product: CommercialTermsMasterReference & { inventoryUnit: { code: string; name: string; symbol: string } };
  supplier: CommercialTermsMasterReference;
};

export type ProductSupplierCommercialTermsView = {
  id: string;
  relationshipId: string;
  unitPrice: string;
  currencyCode: "JPY";
  taxRate: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductSupplierCommercialTermsContextView = {
  relationship: CommercialTermsRelationshipReference;
  terms: ProductSupplierCommercialTermsView | null;
};

export type CommercialTermsInput = {
  unitPrice: string;
  currencyCode: "JPY";
  taxRate: string;
};

export type UpdateCommercialTermsInput = CommercialTermsInput & { expectedVersion: number };

export interface ProductSupplierCommercialTermsRepository {
  get(relationshipId: string): Promise<ProductSupplierCommercialTermsContextView | null>;
  create(relationshipId: string, input: CommercialTermsInput): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT">;
  update(relationshipId: string, input: UpdateCommercialTermsInput): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT">;
  clear(relationshipId: string, expectedVersion: number): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT">;
}

export const PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY = Symbol("PRODUCT_SUPPLIER_COMMERCIAL_TERMS_REPOSITORY");
