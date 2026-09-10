import { ApiError, type ApiRequestOptions } from "./api-client.ts";

const positiveDecimalPattern = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export type ProductSupplierPackageStatus = "ACTIVE" | "DISABLED";

export type ProductSupplierPackage = {
  id: string;
  relationshipId: string;
  code: string;
  name: string;
  inventoryQuantityPerPackage: string;
  isOrderable: boolean;
  status: ProductSupplierPackageStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductSupplierPackageRelationship = {
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

export type ProductSupplierPackagesContext = {
  relationship: ProductSupplierPackageRelationship;
  packages: ProductSupplierPackage[];
};

export type ProductSupplierPackageContext = {
  relationship: ProductSupplierPackageRelationship;
  package: ProductSupplierPackage;
};

export type ProductSupplierPackagesApi = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

export function productSupplierPackagesPath(relationshipId: string, packageId?: string): string {
  const root = `/product-supply-relationships/${encodeURIComponent(relationshipId)}/packages`;
  return packageId === undefined ? root : `${root}/${encodeURIComponent(packageId)}`;
}

export async function requestProductSupplierPackages(
  api: ProductSupplierPackagesApi,
  relationshipId: string,
): Promise<ProductSupplierPackagesContext> {
  const payload = await api.request<unknown>(productSupplierPackagesPath(relationshipId), { expectedStatus: 200 });
  if (!isProductSupplierPackagesContext(payload)) throw new ApiError("server");
  return payload;
}

export async function requestProductSupplierPackage(
  api: ProductSupplierPackagesApi,
  relationshipId: string,
  packageId: string,
): Promise<ProductSupplierPackageContext> {
  const payload = await api.request<unknown>(productSupplierPackagesPath(relationshipId, packageId), { expectedStatus: 200 });
  if (!isProductSupplierPackageContext(payload)) throw new ApiError("server");
  return payload;
}

export async function createProductSupplierPackage(
  api: ProductSupplierPackagesApi,
  relationshipId: string,
  packageValue: Omit<ProductSupplierPackage, "id" | "relationshipId" | "version" | "createdAt" | "updatedAt">,
): Promise<ProductSupplierPackageContext> {
  const payload = await api.request<unknown>(productSupplierPackagesPath(relationshipId), {
    method: "POST",
    body: packageValue,
    expectedStatus: 201,
  });
  if (!isProductSupplierPackageContext(payload)) throw new ApiError("server");
  return payload;
}

export async function updateProductSupplierPackage(
  api: ProductSupplierPackagesApi,
  relationshipId: string,
  packageId: string,
  packageValue: Omit<ProductSupplierPackage, "id" | "relationshipId" | "version" | "createdAt" | "updatedAt">,
  expectedVersion: number,
): Promise<ProductSupplierPackageContext> {
  const payload = await api.request<unknown>(productSupplierPackagesPath(relationshipId, packageId), {
    method: "PATCH",
    body: { ...packageValue, expectedVersion },
    expectedStatus: 200,
  });
  if (!isProductSupplierPackageContext(payload)) throw new ApiError("server");
  return payload;
}

export function validatePackageQuantity(value: string): string | null {
  return positiveDecimalPattern.test(value) ? null : "0より大きく、小数点以下9桁以内の数量で入力してください。";
}

export function isProductSupplierPackagesContext(value: unknown): value is ProductSupplierPackagesContext {
  if (!isRecord(value) || !hasExactlyKeys(value, ["relationship", "packages"])) return false;
  const relationship = value.relationship;
  const packages = value.packages;
  if (!isRelationship(relationship) || !Array.isArray(packages) || !packages.every(isPackage)) return false;
  const ids = new Set(packages.map((item) => item.id));
  const codes = new Set(packages.map((item) => item.code));
  return ids.size === packages.length
    && codes.size === packages.length
    && packages.every((item) => item.relationshipId === relationship.id);
}

export function isProductSupplierPackageContext(value: unknown): value is ProductSupplierPackageContext {
  return isRecord(value)
    && hasExactlyKeys(value, ["relationship", "package"])
    && isRelationship(value.relationship)
    && isPackage(value.package)
    && value.package.relationshipId === value.relationship.id;
}

function isPackage(value: unknown): value is ProductSupplierPackage {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "relationshipId", "code", "name", "inventoryQuantityPerPackage", "isOrderable", "status", "version", "createdAt", "updatedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.relationshipId)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isPositiveDecimal(value.inventoryQuantityPerPackage)
    && typeof value.isOrderable === "boolean"
    && (value.status === "ACTIVE" || value.status === "DISABLED")
    && isPositiveInteger(value.version)
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt);
}

function isRelationship(value: unknown): value is ProductSupplierPackageRelationship {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "status", "version", "product", "supplier"])
    && isNonEmptyString(value.id)
    && (value.status === "ACTIVE" || value.status === "DISABLED")
    && isPositiveInteger(value.version)
    && isProduct(value.product)
    && isSupplier(value.supplier);
}

function isProduct(value: unknown): value is ProductSupplierPackageRelationship["product"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted", "inventoryUnit"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.status === "ACTIVE" || value.status === "INACTIVE")
    && typeof value.isDeleted === "boolean"
    && isInventoryUnit(value.inventoryUnit);
}

function isSupplier(value: unknown): value is ProductSupplierPackageRelationship["supplier"] {
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
