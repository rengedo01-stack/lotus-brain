import { ApiError, type ApiRequestOptions } from "./api-client.ts";

const positiveDecimalPattern = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export type ProductSupplierOrderingTerms = {
  id: string;
  relationshipId: string;
  minimumOrderQuantity: string | null;
  orderMultipleQuantity: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductSupplierOrderingTermsContext = {
  relationship: {
    id: string;
    status: "ACTIVE" | "DISABLED";
    version: number;
    product: {
      id: string;
      code: string;
      name: string;
      status: "ACTIVE" | "INACTIVE";
      isDeleted: boolean;
      inventoryUnit: { code: string; name: string; symbol: string };
    };
    supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; isDeleted: boolean };
  };
  terms: ProductSupplierOrderingTerms | null;
};

export type ProductSupplierOrderingTermsApi = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

export function productSupplierOrderingTermsPath(relationshipId?: string): string {
  return relationshipId === undefined
    ? "/product-supply-relationships/ordering-terms"
    : `/product-supply-relationships/${encodeURIComponent(relationshipId)}/ordering-terms`;
}

export async function requestProductSupplierOrderingTerms(
  api: ProductSupplierOrderingTermsApi,
  relationshipId: string,
): Promise<ProductSupplierOrderingTermsContext> {
  const payload = await api.request<unknown>(productSupplierOrderingTermsPath(relationshipId), { expectedStatus: 200 });
  if (!isProductSupplierOrderingTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export async function requestProductSupplierOrderingTermsList(
  api: ProductSupplierOrderingTermsApi,
  limit = 100,
  offset = 0,
): Promise<ProductSupplierOrderingTermsContext[]> {
  const payload = await api.request<unknown>(`${productSupplierOrderingTermsPath()}?limit=${limit}&offset=${offset}`, { expectedStatus: 200 });
  if (!isProductSupplierOrderingTermsContextList(payload)) throw new ApiError("server");
  return payload;
}

export async function createProductSupplierOrderingTerms(
  api: ProductSupplierOrderingTermsApi,
  relationshipId: string,
  minimumOrderQuantity: string | null,
  orderMultipleQuantity: string | null,
): Promise<ProductSupplierOrderingTermsContext> {
  const payload = await api.request<unknown>(productSupplierOrderingTermsPath(relationshipId), {
    method: "POST",
    body: { minimumOrderQuantity, orderMultipleQuantity },
    expectedStatus: 201,
  });
  if (!isProductSupplierOrderingTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export async function updateProductSupplierOrderingTerms(
  api: ProductSupplierOrderingTermsApi,
  relationshipId: string,
  minimumOrderQuantity: string | null,
  orderMultipleQuantity: string | null,
  expectedVersion: number,
): Promise<ProductSupplierOrderingTermsContext> {
  const payload = await api.request<unknown>(productSupplierOrderingTermsPath(relationshipId), {
    method: "PATCH",
    body: { minimumOrderQuantity, orderMultipleQuantity, expectedVersion },
    expectedStatus: 200,
  });
  if (!isProductSupplierOrderingTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export function validateOrderingTermsQuantity(value: string): string | null {
  if (value.length === 0) return null;
  return positiveDecimalPattern.test(value) ? null : "0より大きく、小数点以下9桁以内の数量で入力してください。";
}

export function isProductSupplierOrderingTermsContext(value: unknown): value is ProductSupplierOrderingTermsContext {
  return isRecord(value)
    && hasExactlyKeys(value, ["relationship", "terms"])
    && isRelationship(value.relationship)
    && (value.terms === null || isTerms(value.terms))
    && (value.terms === null || value.terms.relationshipId === value.relationship.id);
}

export function isProductSupplierOrderingTermsContextList(value: unknown): value is ProductSupplierOrderingTermsContext[] {
  if (!Array.isArray(value) || !value.every(isProductSupplierOrderingTermsContext)) return false;
  const relationshipIds = new Set(value.map((item) => item.relationship.id));
  return relationshipIds.size === value.length && value.every((item) => item.terms !== null);
}

function isTerms(value: unknown): value is ProductSupplierOrderingTerms {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "relationshipId", "minimumOrderQuantity", "orderMultipleQuantity", "version", "createdAt", "updatedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.relationshipId)
    && (value.minimumOrderQuantity === null || isPositiveDecimal(value.minimumOrderQuantity))
    && (value.orderMultipleQuantity === null || isPositiveDecimal(value.orderMultipleQuantity))
    && isPositiveInteger(value.version)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt);
}

function isRelationship(value: unknown): value is ProductSupplierOrderingTermsContext["relationship"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "status", "version", "product", "supplier"])
    && isNonEmptyString(value.id)
    && (value.status === "ACTIVE" || value.status === "DISABLED")
    && isPositiveInteger(value.version)
    && isProduct(value.product)
    && isSupplier(value.supplier);
}

function isProduct(value: unknown): value is ProductSupplierOrderingTermsContext["relationship"]["product"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted", "inventoryUnit"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.status === "ACTIVE" || value.status === "INACTIVE")
    && typeof value.isDeleted === "boolean"
    && isInventoryUnit(value.inventoryUnit);
}

function isSupplier(value: unknown): value is ProductSupplierOrderingTermsContext["relationship"]["supplier"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.status === "ACTIVE" || value.status === "INACTIVE")
    && typeof value.isDeleted === "boolean";
}

function isInventoryUnit(value: unknown): boolean {
  return isRecord(value)
    && hasExactlyKeys(value, ["code", "name", "symbol"])
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.symbol);
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && positiveDecimalPattern.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSerializedDateTime(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
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
