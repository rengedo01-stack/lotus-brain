import { ApiError, type ApiRequestOptions } from "./api-client.ts";

const unitPricePattern = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const taxRatePattern = /^(?:0(?:\.[0-9]{1,4})?|1(?:\.0{1,4})?)$/;

export type ProductSupplierCommercialTerms = {
  id: string;
  relationshipId: string;
  unitPrice: string;
  currencyCode: "JPY";
  taxRate: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductSupplierCommercialTermsContext = {
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
  terms: ProductSupplierCommercialTerms | null;
};

export type ProductSupplierCommercialTermsApi = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

export function productSupplierCommercialTermsPath(relationshipId: string): string {
  return `/product-supply-relationships/${encodeURIComponent(relationshipId)}/commercial-terms`;
}

export async function requestProductSupplierCommercialTerms(
  api: ProductSupplierCommercialTermsApi,
  relationshipId: string,
): Promise<ProductSupplierCommercialTermsContext> {
  const payload = await api.request<unknown>(productSupplierCommercialTermsPath(relationshipId), { expectedStatus: 200 });
  if (!isProductSupplierCommercialTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export async function createProductSupplierCommercialTerms(
  api: ProductSupplierCommercialTermsApi,
  relationshipId: string,
  unitPrice: string,
  taxRate: string,
): Promise<ProductSupplierCommercialTermsContext> {
  const payload = await api.request<unknown>(productSupplierCommercialTermsPath(relationshipId), {
    method: "POST",
    body: { unitPrice, currencyCode: "JPY", taxRate },
    expectedStatus: 201,
  });
  if (!isProductSupplierCommercialTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export async function updateProductSupplierCommercialTerms(
  api: ProductSupplierCommercialTermsApi,
  relationshipId: string,
  unitPrice: string,
  taxRate: string,
  expectedVersion: number,
): Promise<ProductSupplierCommercialTermsContext> {
  const payload = await api.request<unknown>(productSupplierCommercialTermsPath(relationshipId), {
    method: "PATCH",
    body: { unitPrice, currencyCode: "JPY", taxRate, expectedVersion },
    expectedStatus: 200,
  });
  if (!isProductSupplierCommercialTermsContext(payload)) throw new ApiError("server");
  return payload;
}

export async function clearProductSupplierCommercialTerms(
  api: ProductSupplierCommercialTermsApi,
  relationshipId: string,
  expectedVersion: number,
): Promise<ProductSupplierCommercialTermsContext> {
  const payload = await api.request<unknown>(productSupplierCommercialTermsPath(relationshipId), {
    method: "DELETE",
    body: { expectedVersion },
    expectedStatus: 200,
  });
  if (!isProductSupplierCommercialTermsContext(payload) || payload.terms !== null) throw new ApiError("server");
  return payload;
}

export function validateCommercialUnitPrice(value: string): string | null {
  return unitPricePattern.test(value) ? null : "在庫単位あたりの税抜単価を0以上・小数点以下6桁以内で入力してください。";
}

export function validateCommercialTaxRate(value: string): string | null {
  return taxRatePattern.test(value) ? null : "税率は0から1まで・小数点以下4桁以内で入力してください。";
}

export function isProductSupplierCommercialTermsContext(value: unknown): value is ProductSupplierCommercialTermsContext {
  return isRecord(value)
    && hasExactlyKeys(value, ["relationship", "terms"])
    && isRelationship(value.relationship)
    && (value.terms === null || (isTerms(value.terms) && value.terms.relationshipId === value.relationship.id));
}

function isTerms(value: unknown): value is ProductSupplierCommercialTerms {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.relationshipId)
    && isCanonicalUnitPrice(value.unitPrice)
    && value.currencyCode === "JPY"
    && isCanonicalTaxRate(value.taxRate)
    && isPositiveInteger(value.version)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt);
}

function isRelationship(value: unknown): value is ProductSupplierCommercialTermsContext["relationship"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "status", "version", "product", "supplier"])
    && isNonEmptyString(value.id)
    && (value.status === "ACTIVE" || value.status === "DISABLED")
    && isPositiveInteger(value.version)
    && isProduct(value.product)
    && isSupplier(value.supplier);
}

function isProduct(value: unknown): value is ProductSupplierCommercialTermsContext["relationship"]["product"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted", "inventoryUnit"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.status === "ACTIVE" || value.status === "INACTIVE")
    && typeof value.isDeleted === "boolean"
    && isInventoryUnit(value.inventoryUnit);
}

function isSupplier(value: unknown): value is ProductSupplierCommercialTermsContext["relationship"]["supplier"] {
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

function isCanonicalUnitPrice(value: unknown): value is string {
  return typeof value === "string" && unitPricePattern.test(value) && decimalHasExactScale(value, 6);
}

function isCanonicalTaxRate(value: unknown): value is string {
  return typeof value === "string" && taxRatePattern.test(value) && decimalHasExactScale(value, 4);
}

function decimalHasExactScale(value: string, scale: number): boolean {
  const [, fraction = ""] = value.split(".");
  return fraction.length === scale;
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
