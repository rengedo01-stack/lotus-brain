import type { MasterStatus, UnitDimension } from "../../../generated/prisma/client";

export type ListQuery = {
  limit: number;
  offset: number;
};

export type ProductView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  baseUnitId: string;
  inventoryUnitId: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type ProductInput = {
  code: string;
  name: string;
  description?: string | null;
  baseUnitId: string;
  inventoryUnitId: string;
  status?: MasterStatus;
};

export type ProductUpdateInput = {
  name?: string;
  description?: string | null;
  status?: MasterStatus;
};

export type UnitView = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type UnitInput = {
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  status?: MasterStatus;
};

export type UnitUpdateInput = {
  name?: string;
  symbol?: string;
  status?: MasterStatus;
};

export type SupplierView = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type SupplierInput = {
  code: string;
  name: string;
  status?: MasterStatus;
};

export type SupplierUpdateInput = {
  name?: string;
  status?: MasterStatus;
};

export interface MasterRepository {
  createProduct(input: ProductInput): Promise<ProductView>;
  getProduct(id: string): Promise<ProductView | null>;
  listProducts(query: ListQuery): Promise<ProductView[]>;
  updateProduct(id: string, input: ProductUpdateInput): Promise<ProductView | "NOT_FOUND">;

  createUnit(input: UnitInput): Promise<UnitView>;
  getUnit(id: string): Promise<UnitView | null>;
  listUnits(query: ListQuery): Promise<UnitView[]>;
  updateUnit(id: string, input: UnitUpdateInput): Promise<UnitView | "NOT_FOUND">;

  createSupplier(input: SupplierInput): Promise<SupplierView>;
  getSupplier(id: string): Promise<SupplierView | null>;
  listSuppliers(query: ListQuery): Promise<SupplierView[]>;
  updateSupplier(id: string, input: SupplierUpdateInput): Promise<SupplierView | "NOT_FOUND">;
}

export const MASTER_REPOSITORY = Symbol("MASTER_REPOSITORY");
