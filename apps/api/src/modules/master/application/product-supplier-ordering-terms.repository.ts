import type { MasterStatus, ProductSupplyRelationshipStatus } from "../../../generated/prisma/client";
import type { ListQuery } from "./master.repository";

export type OrderingTermsMasterReference = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  isDeleted: boolean;
};

export type OrderingTermsRelationshipReference = {
  id: string;
  status: ProductSupplyRelationshipStatus;
  version: number;
  product: OrderingTermsMasterReference & { inventoryUnit: { code: string; name: string; symbol: string } };
  supplier: OrderingTermsMasterReference;
};

export type ProductSupplierOrderingTermsView = {
  id: string;
  relationshipId: string;
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProductSupplierOrderingTermsContextView = {
  relationship: OrderingTermsRelationshipReference;
  terms: ProductSupplierOrderingTermsView | null;
};

export type OrderingTermsInput = {
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
};

export type UpdateOrderingTermsInput = OrderingTermsInput & { expectedVersion: number };

export interface ProductSupplierOrderingTermsRepository {
  get(relationshipId: string): Promise<ProductSupplierOrderingTermsContextView | null>;
  list(query: ListQuery): Promise<ProductSupplierOrderingTermsContextView[]>;
  create(relationshipId: string, input: OrderingTermsInput): Promise<ProductSupplierOrderingTermsContextView | "NOT_FOUND" | "CONFLICT">;
  update(relationshipId: string, input: UpdateOrderingTermsInput): Promise<ProductSupplierOrderingTermsContextView | "NOT_FOUND" | "CONFLICT">;
}

export const PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY = Symbol("PRODUCT_SUPPLIER_ORDERING_TERMS_REPOSITORY");
