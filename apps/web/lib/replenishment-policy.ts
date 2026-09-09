import { ApiError, type ApiRequestOptions } from "./api-client.ts";

export type ReplenishmentPolicy = {
  id: string;
  productId: string;
  reorderPointQuantity: string;
  targetStockQuantity: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ReplenishmentPolicyContext = {
  product: {
    id: string;
    code: string;
    name: string;
    status: "ACTIVE" | "INACTIVE";
    isDeleted: boolean;
    inventoryUnit: { code: string; name: string; symbol: string };
  };
  policy: ReplenishmentPolicy | null;
};

export type ReplenishmentPolicyApi = {
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

const decimalPattern = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export function replenishmentPolicyPath(productId: string): string {
  return `/products/${encodeURIComponent(productId)}/replenishment-policy`;
}

export async function requestReplenishmentPolicyContext(api: ReplenishmentPolicyApi, productId: string): Promise<ReplenishmentPolicyContext> {
  const payload = await api.request<unknown>(replenishmentPolicyPath(productId), { expectedStatus: 200 });
  if (!isReplenishmentPolicyContext(payload)) throw new ApiError("server");
  return payload;
}

export async function createReplenishmentPolicy(
  api: ReplenishmentPolicyApi,
  productId: string,
  reorderPointQuantity: string,
  targetStockQuantity: string | null,
): Promise<ReplenishmentPolicy> {
  const payload = await api.request<unknown>(replenishmentPolicyPath(productId), {
    method: "POST",
    body: { reorderPointQuantity, targetStockQuantity },
    expectedStatus: 201,
  });
  if (!isReplenishmentPolicy(payload)) throw new ApiError("server");
  return payload;
}

export async function updateReplenishmentPolicy(
  api: ReplenishmentPolicyApi,
  productId: string,
  reorderPointQuantity: string,
  targetStockQuantity: string | null,
  expectedVersion: number,
): Promise<ReplenishmentPolicy> {
  const payload = await api.request<unknown>(replenishmentPolicyPath(productId), {
    method: "PATCH",
    body: { reorderPointQuantity, targetStockQuantity, expectedVersion },
    expectedStatus: 200,
  });
  if (!isReplenishmentPolicy(payload)) throw new ApiError("server");
  return payload;
}

export function validateReorderPointQuantity(value: string): string | null {
  if (!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/.test(value.trim())) {
    return "補充点は0以上・小数点以下9桁以内の数量で入力してください。";
  }
  return null;
}

export function validateTargetStockQuantity(
  reorderPointQuantity: string,
  targetStockQuantity: string | null,
): string | null {
  if (targetStockQuantity === null) return null;
  if (!decimalPattern.test(targetStockQuantity)) {
    return "目標在庫は0以上・小数点以下9桁以内の数量で入力してください。";
  }
  if (compareQuantities(targetStockQuantity, reorderPointQuantity) < 0) {
    return "目標在庫は発注点以上で設定してください。";
  }
  return null;
}

export function isReplenishmentPolicyContext(value: unknown): value is ReplenishmentPolicyContext {
  return isRecord(value)
    && hasExactlyKeys(value, ["product", "policy"])
    && isProduct(value.product)
    && (value.policy === null || isReplenishmentPolicy(value.policy));
}

export function isReplenishmentPolicy(value: unknown): value is ReplenishmentPolicy {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "productId", "reorderPointQuantity", "targetStockQuantity", "version", "createdAt", "updatedAt"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.productId)
    && isDecimalString(value.reorderPointQuantity)
    && (value.targetStockQuantity === null || isDecimalString(value.targetStockQuantity))
    && typeof value.version === "number"
    && Number.isInteger(value.version)
    && value.version > 0
    && isSerializedDateTime(value.createdAt)
    && isSerializedDateTime(value.updatedAt);
}

function isProduct(value: unknown): value is ReplenishmentPolicyContext["product"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted", "inventoryUnit"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && (value.status === "ACTIVE" || value.status === "INACTIVE")
    && typeof value.isDeleted === "boolean"
    && isInventoryUnit(value.inventoryUnit);
}

function isInventoryUnit(value: unknown): value is ReplenishmentPolicyContext["product"]["inventoryUnit"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["code", "name", "symbol"])
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.symbol);
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && decimalPattern.test(value);
}

function compareQuantities(left: string, right: string): number {
  const normalize = (value: string): bigint => {
    const [integer, fraction = ""] = value.split(".");
    return BigInt(`${integer}${fraction.padEnd(9, "0")}`);
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

function isSerializedDateTime(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
