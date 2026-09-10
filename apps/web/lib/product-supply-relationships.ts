import { ApiError, type ApiRequestOptions } from "./api-client.ts";

const masterStatuses = ["ACTIVE", "INACTIVE"] as const;
const relationshipStatuses = ["ACTIVE", "DISABLED"] as const;

export type ProductSupplyRelationshipStatus = (typeof relationshipStatuses)[number];

export type ProductSupplyRelationshipReference = {
  id: string;
  code: string;
  name: string;
  status: (typeof masterStatuses)[number];
  isDeleted: boolean;
};

export type ProductSupplyRelationship = {
  id: string;
  productId: string;
  supplierId: string;
  status: ProductSupplyRelationshipStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  product: ProductSupplyRelationshipReference;
  supplier: ProductSupplyRelationshipReference;
};

export type ProductSupplyRelationshipProductOption = {
  id: string;
  code: string;
  name: string;
  status: (typeof masterStatuses)[number];
  deletedAt: string | null;
};

export type ProductSupplyRelationshipSupplierOption = ProductSupplyRelationshipProductOption;

export type ProductSupplyRelationshipApi = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

export const PRODUCT_SUPPLY_RELATIONSHIP_STATUSES = relationshipStatuses;

export function productSupplyRelationshipPath(id?: string): string {
  return id === undefined
    ? "/product-supply-relationships"
    : `/product-supply-relationships/${encodeURIComponent(id)}`;
}

export async function requestProductSupplyRelationships(
  api: ProductSupplyRelationshipApi,
  limit = 100,
  offset = 0,
): Promise<ProductSupplyRelationship[]> {
  const payload = await api.request<unknown>(`${productSupplyRelationshipPath()}?limit=${limit}&offset=${offset}`, { expectedStatus: 200 });
  if (!isProductSupplyRelationshipList(payload)) throw new ApiError("server");
  return payload;
}

export async function requestProductSupplyRelationship(
  api: ProductSupplyRelationshipApi,
  id: string,
): Promise<ProductSupplyRelationship> {
  const payload = await api.request<unknown>(productSupplyRelationshipPath(id), { expectedStatus: 200 });
  if (!isProductSupplyRelationship(payload)) throw new ApiError("server");
  return payload;
}

export async function createProductSupplyRelationship(
  api: ProductSupplyRelationshipApi,
  productId: string,
  supplierId: string,
): Promise<ProductSupplyRelationship> {
  const payload = await api.request<unknown>(productSupplyRelationshipPath(), {
    method: "POST",
    body: { productId, supplierId },
    expectedStatus: 201,
  });
  if (!isProductSupplyRelationship(payload)) throw new ApiError("server");
  return payload;
}

export async function updateProductSupplyRelationshipStatus(
  api: ProductSupplyRelationshipApi,
  id: string,
  status: ProductSupplyRelationshipStatus,
  expectedVersion: number,
): Promise<ProductSupplyRelationship> {
  const payload = await api.request<unknown>(productSupplyRelationshipPath(id), {
    method: "PATCH",
    body: { status, expectedVersion },
    expectedStatus: 200,
  });
  if (!isProductSupplyRelationship(payload)) throw new ApiError("server");
  return payload;
}

export async function requestProductSupplyRelationshipProductOptions(
  api: ProductSupplyRelationshipApi,
): Promise<ProductSupplyRelationshipProductOption[]> {
  const payload = await api.request<unknown>("/products?limit=100&offset=0", { expectedStatus: 200 });
  if (!isProductSupplyRelationshipProductOptionList(payload)) throw new ApiError("server");
  return payload;
}

export async function requestProductSupplyRelationshipSupplierOptions(
  api: ProductSupplyRelationshipApi,
): Promise<ProductSupplyRelationshipSupplierOption[]> {
  const payload = await api.request<unknown>("/suppliers?limit=100&offset=0", { expectedStatus: 200 });
  if (!isProductSupplyRelationshipSupplierOptionList(payload)) throw new ApiError("server");
  return payload;
}

export function isProductSupplyRelationship(value: unknown): value is ProductSupplyRelationship {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "productId", "supplierId", "status", "version", "createdAt", "updatedAt", "product", "supplier"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.productId)
    && isNonEmptyString(value.supplierId)
    && isRelationshipStatus(value.status)
    && isPositiveInteger(value.version)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt)
    && isProductSupplyRelationshipReference(value.product)
    && isProductSupplyRelationshipReference(value.supplier)
    && value.product.id === value.productId
    && value.supplier.id === value.supplierId;
}

export function isProductSupplyRelationshipList(value: unknown): value is ProductSupplyRelationship[] {
  if (!Array.isArray(value) || !value.every(isProductSupplyRelationship)) return false;
  const ids = new Set(value.map((relationship) => relationship.id));
  return ids.size === value.length;
}

function isProductSupplyRelationshipReference(value: unknown): value is ProductSupplyRelationshipReference {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isMasterStatus(value.status)
    && typeof value.isDeleted === "boolean";
}

function isProductSupplyRelationshipProductOption(value: unknown): value is ProductSupplyRelationshipProductOption {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "description", "baseUnitId", "inventoryUnitId", "status", "createdAt", "updatedAt", "deletedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.description === null || typeof value.description === "string")
    && isNonEmptyString(value.baseUnitId)
    && isNonEmptyString(value.inventoryUnitId)
    && isMasterStatus(value.status)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt)
    && isNullableSerializedDateTime(value.deletedAt);
}

function isProductSupplyRelationshipSupplierOption(value: unknown): value is ProductSupplyRelationshipSupplierOption {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "createdAt", "updatedAt", "deletedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isMasterStatus(value.status)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt)
    && isNullableSerializedDateTime(value.deletedAt);
}

function isProductSupplyRelationshipProductOptionList(value: unknown): value is ProductSupplyRelationshipProductOption[] {
  return Array.isArray(value) && value.every(isProductSupplyRelationshipProductOption);
}

function isProductSupplyRelationshipSupplierOptionList(value: unknown): value is ProductSupplyRelationshipSupplierOption[] {
  return Array.isArray(value) && value.every(isProductSupplyRelationshipSupplierOption);
}

function isRelationshipStatus(value: unknown): value is ProductSupplyRelationshipStatus {
  return relationshipStatuses.includes(value as ProductSupplyRelationshipStatus);
}

function isMasterStatus(value: unknown): value is (typeof masterStatuses)[number] {
  return masterStatuses.includes(value as (typeof masterStatuses)[number]);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSerializedDateTime(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isNullableSerializedDateTime(value: unknown): value is string | null {
  return value === null || isSerializedDateTime(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
