import { ApiError, type ApiRequestOptions } from "./api-client.ts";

export type ReplenishmentRecommendationDisposition = "ACTIVE" | "SUPERSEDED" | "DISMISSED";
export type ReplenishmentRecommendationFreshness = "CURRENT" | "STALE" | "INVALID";
export type ReplenishmentRecommendationApi = { request<T>(path: string, options?: ApiRequestOptions): Promise<T> };

export type ReplenishmentRecommendation = {
  id: string;
  disposition: ReplenishmentRecommendationDisposition;
  version: number;
  calculationPolicyVersion: number;
  createdAt: string;
  supersededAt: string | null;
  dismissedAt: string | null;
  freshness: ReplenishmentRecommendationFreshness;
  product: { id: string; code: string; name: string };
  inventoryUnit: { code: string; name: string; symbol: string };
  snapshot: {
    currentQuantity: string;
    inventoryVersion: number;
    reorderPointQuantity: string;
    targetStockQuantity: string;
    replenishmentPolicyVersion: number;
    draftPurchaseQuantity: string;
    confirmedPurchaseQuantity: string;
    preferredSupplier: {
      relationshipId: string;
      relationshipVersion: number;
      preferenceVersion: number;
      supplier: { id: string; code: string; name: string };
    };
    orderingTerms: { minimumOrderQuantity: string | null; orderMultipleQuantity: string | null; version: number } | null;
    preferredPackage: { id: string; code: string; name: string; inventoryQuantityPerPackage: string; version: number; preferenceVersion: number } | null;
    result: { rawTargetGap: string; feasibleQuantity: string; overOrderQuantity: string; packageCount: string | null };
  };
};

export function replenishmentRecommendationPath(productId: string): string {
  return `/inventory/${encodeURIComponent(productId)}/replenishment-recommendation`;
}

export async function requestActiveReplenishmentRecommendation(
  api: ReplenishmentRecommendationApi,
  productId: string,
): Promise<ReplenishmentRecommendation | null> {
  const payload = await api.request<unknown>(replenishmentRecommendationPath(productId), { expectedStatus: 200 });
  if (!isActiveReplenishmentRecommendationResponse(payload)) throw new ApiError("server");
  return payload.recommendation;
}

export async function recalculateReplenishmentRecommendation(
  api: ReplenishmentRecommendationApi,
  productId: string,
): Promise<ReplenishmentRecommendation> {
  const payload = await api.request<unknown>(replenishmentRecommendationPath(productId), { method: "POST", expectedStatus: 200 });
  if (!isReplenishmentRecommendationMutationResponse(payload)) throw new ApiError("server");
  return payload.recommendation;
}

export async function dismissReplenishmentRecommendation(
  api: ReplenishmentRecommendationApi,
  productId: string,
  recommendationId: string,
  expectedVersion: number,
): Promise<ReplenishmentRecommendation> {
  const payload = await api.request<unknown>(`${replenishmentRecommendationPath(productId)}/${encodeURIComponent(recommendationId)}/dismiss`, {
    method: "POST",
    body: { expectedVersion },
    expectedStatus: 200,
  });
  if (!isReplenishmentRecommendationMutationResponse(payload)) throw new ApiError("server");
  return payload.recommendation;
}

export function isActiveReplenishmentRecommendationResponse(value: unknown): value is { recommendation: ReplenishmentRecommendation | null } {
  return isRecord(value) && hasExactlyKeys(value, ["recommendation"]) && (value.recommendation === null || isReplenishmentRecommendation(value.recommendation));
}

export function isReplenishmentRecommendationMutationResponse(value: unknown): value is { recommendation: ReplenishmentRecommendation } {
  return isRecord(value) && hasExactlyKeys(value, ["recommendation"]) && isReplenishmentRecommendation(value.recommendation);
}

export function isReplenishmentRecommendation(value: unknown): value is ReplenishmentRecommendation {
  if (!isRecord(value) || !hasExactlyKeys(value, ["id", "disposition", "version", "calculationPolicyVersion", "createdAt", "supersededAt", "dismissedAt", "freshness", "product", "inventoryUnit", "snapshot"])) return false;
  return isNonEmptyString(value.id)
    && isDisposition(value.disposition)
    && isVersion(value.version)
    && isVersion(value.calculationPolicyVersion)
    && isDateTime(value.createdAt)
    && isNullableDateTime(value.supersededAt)
    && isNullableDateTime(value.dismissedAt)
    && isFreshness(value.freshness)
    && isProduct(value.product)
    && isInventoryUnit(value.inventoryUnit)
    && isSnapshot(value.snapshot)
    && lifecycleIsConsistent(value as ReplenishmentRecommendation);
}

const decimal24_9Pattern = /^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

function isSnapshot(value: unknown): value is ReplenishmentRecommendation["snapshot"] {
  if (!isRecord(value) || !hasExactlyKeys(value, ["currentQuantity", "inventoryVersion", "reorderPointQuantity", "targetStockQuantity", "replenishmentPolicyVersion", "draftPurchaseQuantity", "confirmedPurchaseQuantity", "preferredSupplier", "orderingTerms", "preferredPackage", "result"])) return false;
  return isNonNegativeDecimal(value.currentQuantity)
    && isVersion(value.inventoryVersion)
    && isNonNegativeDecimal(value.reorderPointQuantity)
    && isNonNegativeDecimal(value.targetStockQuantity)
    && isVersion(value.replenishmentPolicyVersion)
    && isNonNegativeDecimal(value.draftPurchaseQuantity)
    && isNonNegativeDecimal(value.confirmedPurchaseQuantity)
    && isPreferredSupplier(value.preferredSupplier)
    && (value.orderingTerms === null || isOrderingTerms(value.orderingTerms))
    && (value.preferredPackage === null || isPreferredPackage(value.preferredPackage))
    && isResult(value.result)
    && (value.preferredPackage === null ? value.result.packageCount === null : value.result.packageCount !== null);
}

function isPreferredSupplier(value: unknown): boolean {
  return isRecord(value)
    && hasExactlyKeys(value, ["relationshipId", "relationshipVersion", "preferenceVersion", "supplier"])
    && isNonEmptyString(value.relationshipId)
    && isVersion(value.relationshipVersion)
    && isVersion(value.preferenceVersion)
    && isSupplier(value.supplier);
}

function isOrderingTerms(value: unknown): boolean {
  return isRecord(value)
    && hasExactlyKeys(value, ["minimumOrderQuantity", "orderMultipleQuantity", "version"])
    && isNullablePositiveDecimal(value.minimumOrderQuantity)
    && isNullablePositiveDecimal(value.orderMultipleQuantity)
    && isVersion(value.version);
}

function isPreferredPackage(value: unknown): boolean {
  return isRecord(value)
    && hasExactlyKeys(value, ["id", "code", "name", "inventoryQuantityPerPackage", "version", "preferenceVersion"])
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.code)
    && isNonEmptyString(value.name)
    && isPositiveDecimal(value.inventoryQuantityPerPackage)
    && isVersion(value.version)
    && isVersion(value.preferenceVersion);
}

function isResult(value: unknown): value is ReplenishmentRecommendation["snapshot"]["result"] {
  return isRecord(value)
    && hasExactlyKeys(value, ["rawTargetGap", "feasibleQuantity", "overOrderQuantity", "packageCount"])
    && isPositiveDecimal(value.rawTargetGap)
    && isPositiveDecimal(value.feasibleQuantity)
    && isNonNegativeDecimal(value.overOrderQuantity)
    && (value.packageCount === null || (typeof value.packageCount === "string" && /^[1-9][0-9]*$/.test(value.packageCount)));
}

function lifecycleIsConsistent(value: ReplenishmentRecommendation): boolean {
  if (value.disposition === "ACTIVE") return value.supersededAt === null && value.dismissedAt === null;
  if (value.disposition === "SUPERSEDED") return value.supersededAt !== null && value.dismissedAt === null;
  return value.supersededAt === null && value.dismissedAt !== null;
}

function isDisposition(value: unknown): value is ReplenishmentRecommendationDisposition { return value === "ACTIVE" || value === "SUPERSEDED" || value === "DISMISSED"; }
function isFreshness(value: unknown): value is ReplenishmentRecommendationFreshness { return value === "CURRENT" || value === "STALE" || value === "INVALID"; }
function isProduct(value: unknown): boolean { return isRecord(value) && hasExactlyKeys(value, ["id", "code", "name"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name); }
function isSupplier(value: unknown): boolean { return isProduct(value); }
function isInventoryUnit(value: unknown): boolean { return isRecord(value) && hasExactlyKeys(value, ["code", "name", "symbol"]) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && isNonEmptyString(value.symbol); }
function isVersion(value: unknown): boolean { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function isNonNegativeDecimal(value: unknown): value is string { return typeof value === "string" && decimal24_9Pattern.test(value); }
function isPositiveDecimal(value: unknown): boolean { return isNonNegativeDecimal(value) && value !== "0" && !/^0(?:\.0+)?$/.test(value); }
function isNullablePositiveDecimal(value: unknown): boolean { return value === null || isPositiveDecimal(value); }
function isDateTime(value: unknown): boolean { return isNonEmptyString(value) && !Number.isNaN(new Date(value).getTime()) && new Date(value).toISOString() === value; }
function isNullableDateTime(value: unknown): boolean { return value === null || isDateTime(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actualKeys = Object.keys(value); return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
