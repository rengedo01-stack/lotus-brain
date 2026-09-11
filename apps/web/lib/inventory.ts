import { ApiError, type ApiRequestOptions } from "./api-client.ts";

export type InventoryTransactionType = "RECEIPT" | "CONSUMPTION" | "PRODUCTION_RECEIPT" | "STOCKTAKE_ADJUSTMENT" | "MANUAL_ADJUSTMENT";
export type InventoryUnit = { code: string; name: string; symbol: string };
export type InventoryProduct = { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; isDeleted: boolean };
export type CurrentInventory = { product: InventoryProduct; quantity: string; inventoryUnit: InventoryUnit; updatedAt: string };
export type InventoryHistory = { id: string; type: InventoryTransactionType; quantityDelta: string; quantityAfter: string; occurredAt: string; inventoryUnit: InventoryUnit };
export type CurrentInventoryPage = { items: CurrentInventory[]; nextCursor: string | null };
export type InventoryHistoryPage = { currentInventory: CurrentInventory; items: InventoryHistory[]; nextCursor: string | null };
export type InventorySupplyProduct = Pick<InventoryProduct, "id" | "code" | "name">;
export type InventorySupplyContext = {
  product: InventorySupplyProduct;
  inventoryUnit: InventoryUnit;
  currentQuantity: string;
  draftPurchaseQuantity: string;
  confirmedPurchaseQuantity: string;
};
export type InventorySupplyContextPage = { items: InventorySupplyContext[]; nextCursor: string | null };
export type InventorySupplyContextApi = { request<T>(path: string, options?: ApiRequestOptions): Promise<T> };
export type ReplenishmentCandidate = InventorySupplyContext & { reorderPointQuantity: string };
export type ReplenishmentCandidatePage = { items: ReplenishmentCandidate[]; nextCursor: string | null };
export type ReplenishmentCandidateApi = { request<T>(path: string, options?: ApiRequestOptions): Promise<T> };
export type ReplenishmentQuantityPreviewStatus = "READY" | "TARGET_NOT_CONFIGURED" | "NO_POSITIVE_NEED" | "INVENTORY_RECONCILIATION_REQUIRED" | "NO_PREFERRED_SUPPLIER" | "PREFERRED_SUPPLIER_INELIGIBLE" | "PREFERRED_PACKAGE_INELIGIBLE" | "CONSTRAINT_UNREPRESENTABLE" | "NOT_A_REPLENISHMENT_CANDIDATE";
export type ReplenishmentQuantityPreview = {
  product: InventorySupplyProduct;
  inventoryUnit: InventoryUnit;
  currentQuantity: string | null;
  reorderPointQuantity: string | null;
  targetStockQuantity: string | null;
  draftPurchaseQuantity: string | null;
  confirmedPurchaseQuantity: string | null;
  preferredSupplier: { relationshipId: string; supplier: { id: string; code: string; name: string }; isEligible: boolean } | null;
  orderingTerms: { minimumOrderQuantity: string | null; orderMultipleQuantity: string | null } | null;
  preferredPackage: { id: string; code: string; name: string; inventoryQuantityPerPackage: string; isEligible: boolean } | null;
  result: { status: ReplenishmentQuantityPreviewStatus; rawTargetGap: string | null; feasibleQuantity: string | null; overOrderQuantity: string | null; packageCount: string | null };
};
export type ReplenishmentQuantityPreviewApi = { request<T>(path: string, options?: ApiRequestOptions): Promise<T> };

const transactionTypes = new Set<InventoryTransactionType>(["RECEIPT", "CONSUMPTION", "PRODUCTION_RECEIPT", "STOCKTAKE_ADJUSTMENT", "MANUAL_ADJUSTMENT"]);
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const decimal24_9Pattern = /^-?(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/;

export function isCurrentInventoryPage(value: unknown): value is CurrentInventoryPage {
  return isRecord(value) && hasExactlyKeys(value, ["items", "nextCursor"]) && Array.isArray(value.items) && value.items.every(isCurrentInventory) && isCursor(value.nextCursor);
}

export function isInventoryHistoryPage(value: unknown): value is InventoryHistoryPage {
  return isRecord(value) && hasExactlyKeys(value, ["currentInventory", "items", "nextCursor"]) && isCurrentInventory(value.currentInventory) && Array.isArray(value.items) && value.items.every(isInventoryHistory) && isCursor(value.nextCursor);
}

export function isInventorySupplyContextPage(value: unknown): value is InventorySupplyContextPage {
  return isRecord(value)
    && hasExactlyKeys(value, ["items", "nextCursor"])
    && Array.isArray(value.items)
    && value.items.every(isInventorySupplyContext)
    && isCursor(value.nextCursor);
}

export function isReplenishmentCandidatePage(value: unknown): value is ReplenishmentCandidatePage {
  return isRecord(value)
    && hasExactlyKeys(value, ["items", "nextCursor"])
    && Array.isArray(value.items)
    && value.items.every(isReplenishmentCandidate)
    && isCursor(value.nextCursor);
}

export function isReplenishmentQuantityPreview(value: unknown): value is ReplenishmentQuantityPreview {
  if (!isRecord(value) || !hasExactlyKeys(value, ["product", "inventoryUnit", "currentQuantity", "reorderPointQuantity", "targetStockQuantity", "draftPurchaseQuantity", "confirmedPurchaseQuantity", "preferredSupplier", "orderingTerms", "preferredPackage", "result"])) return false;
  if (!isInventorySupplyProduct(value.product) || !isInventoryUnit(value.inventoryUnit) || !isNullableDecimal24_9(value.currentQuantity) || !isNullableDecimal24_9(value.reorderPointQuantity) || !isNullableDecimal24_9(value.targetStockQuantity) || !isNullableDecimal24_9(value.draftPurchaseQuantity) || !isNullableDecimal24_9(value.confirmedPurchaseQuantity) || !isPreferredSupplier(value.preferredSupplier) || !isOrderingTerms(value.orderingTerms) || !isPreferredPackage(value.preferredPackage) || !isQuantityPreviewResult(value.result)) return false;
  if (value.preferredSupplier === null && (value.orderingTerms !== null || value.preferredPackage !== null)) return false;
  if (value.result.status === "READY") {
    if (value.preferredSupplier === null || !value.preferredSupplier.isEligible || (value.preferredPackage !== null && !value.preferredPackage.isEligible)) return false;
    if (value.preferredPackage === null && value.result.packageCount !== null) return false;
    if (value.preferredPackage !== null && value.result.packageCount === null) return false;
  }
  if (value.result.status === "NO_POSITIVE_NEED" && value.result.rawTargetGap !== "0") return false;
  return true;
}

export function currentInventoryPath(productCode?: string, cursor?: string): string {
  const query = new URLSearchParams(); query.set("limit", "50");
  if (productCode !== undefined && productCode.length > 0) query.set("productCode", productCode);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/inventory?${query.toString()}`;
}

export function inventoryHistoryPath(productId: string, filters: { type?: InventoryTransactionType; from?: string; to?: string }, cursor?: string): string {
  const query = new URLSearchParams(); query.set("limit", "50");
  if (filters.type !== undefined) query.set("type", filters.type);
  if (filters.from !== undefined && filters.from.length > 0) query.set("from", filters.from);
  if (filters.to !== undefined && filters.to.length > 0) query.set("to", filters.to);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/inventory/${encodeURIComponent(productId)}/history?${query.toString()}`;
}

export function inventorySupplyContextPath(productCode?: string, cursor?: string): string {
  const query = new URLSearchParams(); query.set("limit", "50");
  if (productCode !== undefined && productCode.length > 0) query.set("productCode", productCode);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/inventory/supply-context?${query.toString()}`;
}

export function replenishmentCandidatePath(productCode?: string, cursor?: string): string {
  const query = new URLSearchParams(); query.set("limit", "50");
  if (productCode !== undefined && productCode.length > 0) query.set("productCode", productCode);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/inventory/replenishment-candidates?${query.toString()}`;
}

export function replenishmentQuantityPreviewPath(productId: string): string {
  return `/inventory/${encodeURIComponent(productId)}/replenishment-quantity-preview`;
}

export async function requestInventorySupplyContext(
  api: InventorySupplyContextApi,
  productCode?: string,
  cursor?: string,
): Promise<InventorySupplyContextPage> {
  const payload = await api.request<unknown>(inventorySupplyContextPath(productCode, cursor), { expectedStatus: 200 });
  if (!isInventorySupplyContextPage(payload)) throw new ApiError("server");
  return payload;
}

export async function requestReplenishmentCandidates(
  api: ReplenishmentCandidateApi,
  productCode?: string,
  cursor?: string,
): Promise<ReplenishmentCandidatePage> {
  const payload = await api.request<unknown>(replenishmentCandidatePath(productCode, cursor), { expectedStatus: 200 });
  if (!isReplenishmentCandidatePage(payload)) throw new ApiError("server");
  return payload;
}

export async function requestReplenishmentQuantityPreview(
  api: ReplenishmentQuantityPreviewApi,
  productId: string,
): Promise<ReplenishmentQuantityPreview> {
  const payload = await api.request<unknown>(replenishmentQuantityPreviewPath(productId), { expectedStatus: 200 });
  if (!isReplenishmentQuantityPreview(payload)) throw new ApiError("server");
  return payload;
}

export function inventoryTransactionLabel(type: InventoryTransactionType): string {
  switch (type) { case "RECEIPT": return "購入入庫"; case "CONSUMPTION": return "生産消費"; case "PRODUCTION_RECEIPT": return "生産入庫"; case "STOCKTAKE_ADJUSTMENT": return "棚卸調整"; case "MANUAL_ADJUSTMENT": return "手動調整"; }
}

export function inventoryProductStateLabel(product: InventoryProduct): string { return product.isDeleted ? "削除済み" : product.status === "ACTIVE" ? "有効" : "無効"; }

function isCurrentInventory(value: unknown): value is CurrentInventory { return isRecord(value) && hasExactlyKeys(value, ["product", "quantity", "inventoryUnit", "updatedAt"]) && isInventoryProduct(value.product) && isDecimalString(value.quantity) && isInventoryUnit(value.inventoryUnit) && isSerializedDateTime(value.updatedAt); }
function isInventoryHistory(value: unknown): value is InventoryHistory { return isRecord(value) && hasExactlyKeys(value, ["id", "type", "quantityDelta", "quantityAfter", "occurredAt", "inventoryUnit"]) && isNonEmptyString(value.id) && transactionTypes.has(value.type as InventoryTransactionType) && isDecimalString(value.quantityDelta) && isDecimalString(value.quantityAfter) && isSerializedDateTime(value.occurredAt) && isInventoryUnit(value.inventoryUnit); }
function isInventorySupplyContext(value: unknown): value is InventorySupplyContext { return isRecord(value) && hasExactlyKeys(value, ["product", "inventoryUnit", "currentQuantity", "draftPurchaseQuantity", "confirmedPurchaseQuantity"]) && isInventorySupplyProduct(value.product) && isInventoryUnit(value.inventoryUnit) && isDecimalString(value.currentQuantity) && isDecimalString(value.draftPurchaseQuantity) && isDecimalString(value.confirmedPurchaseQuantity); }
function isReplenishmentCandidate(value: unknown): value is ReplenishmentCandidate { return isRecord(value) && hasExactlyKeys(value, ["product", "inventoryUnit", "currentQuantity", "reorderPointQuantity", "draftPurchaseQuantity", "confirmedPurchaseQuantity"]) && isInventorySupplyProduct(value.product) && isInventoryUnit(value.inventoryUnit) && isDecimalString(value.currentQuantity) && isDecimalString(value.reorderPointQuantity) && isDecimalString(value.draftPurchaseQuantity) && isDecimalString(value.confirmedPurchaseQuantity); }
function isPreferredSupplier(value: unknown): value is ReplenishmentQuantityPreview["preferredSupplier"] { return value === null || (isRecord(value) && hasExactlyKeys(value, ["relationshipId", "supplier", "isEligible"]) && isNonEmptyString(value.relationshipId) && isRecord(value.supplier) && hasExactlyKeys(value.supplier, ["id", "code", "name"]) && isNonEmptyString(value.supplier.id) && isNonEmptyString(value.supplier.code) && isNonEmptyString(value.supplier.name) && typeof value.isEligible === "boolean"); }
function isOrderingTerms(value: unknown): value is ReplenishmentQuantityPreview["orderingTerms"] { return value === null || (isRecord(value) && hasExactlyKeys(value, ["minimumOrderQuantity", "orderMultipleQuantity"]) && isNullablePositiveDecimal24_9(value.minimumOrderQuantity) && isNullablePositiveDecimal24_9(value.orderMultipleQuantity)); }
function isPreferredPackage(value: unknown): value is ReplenishmentQuantityPreview["preferredPackage"] { return value === null || (isRecord(value) && hasExactlyKeys(value, ["id", "code", "name", "inventoryQuantityPerPackage", "isEligible"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && isPositiveDecimal24_9(value.inventoryQuantityPerPackage) && typeof value.isEligible === "boolean"); }
function isQuantityPreviewResult(value: unknown): value is ReplenishmentQuantityPreview["result"] {
  if (!isRecord(value) || !hasExactlyKeys(value, ["status", "rawTargetGap", "feasibleQuantity", "overOrderQuantity", "packageCount"]) || !isReplenishmentQuantityPreviewStatus(value.status) || !isNullableNonNegativeDecimal24_9(value.rawTargetGap) || !isNullableNonNegativeDecimal24_9(value.feasibleQuantity) || !isNullableNonNegativeDecimal24_9(value.overOrderQuantity) || !(value.packageCount === null || isPositiveIntegerString(value.packageCount))) return false;
  if (value.status === "READY") return value.rawTargetGap !== null && value.feasibleQuantity !== null && value.overOrderQuantity !== null;
  return value.feasibleQuantity === null && value.overOrderQuantity === null && value.packageCount === null;
}
function isInventoryProduct(value: unknown): value is InventoryProduct { return isRecord(value) && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && (value.status === "ACTIVE" || value.status === "INACTIVE") && typeof value.isDeleted === "boolean"; }
function isInventorySupplyProduct(value: unknown): value is InventorySupplyProduct { return isRecord(value) && hasExactlyKeys(value, ["id", "code", "name"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name); }
function isInventoryUnit(value: unknown): value is InventoryUnit { return isRecord(value) && hasExactlyKeys(value, ["code", "name", "symbol"]) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && isNonEmptyString(value.symbol); }
function isCursor(value: unknown): value is string | null { return value === null || isNonEmptyString(value); }
function isDecimalString(value: unknown): value is string { return typeof value === "string" && decimalPattern.test(value); }
function isNullableDecimal24_9(value: unknown): value is string | null { return value === null || isDecimal24_9(value); }
function isNullableNonNegativeDecimal24_9(value: unknown): value is string | null { return value === null || (isDecimal24_9(value) && !value.startsWith("-")); }
function isNullablePositiveDecimal24_9(value: unknown): value is string | null { return value === null || isPositiveDecimal24_9(value); }
function isPositiveDecimal24_9(value: unknown): value is string { return isDecimal24_9(value) && !value.startsWith("-") && value !== "0" && !/^0(?:\.0+)?$/.test(value); }
function isDecimal24_9(value: unknown): value is string { return typeof value === "string" && decimal24_9Pattern.test(value); }
function isPositiveIntegerString(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]*$/.test(value); }
function isReplenishmentQuantityPreviewStatus(value: unknown): value is ReplenishmentQuantityPreviewStatus { return value === "READY" || value === "TARGET_NOT_CONFIGURED" || value === "NO_POSITIVE_NEED" || value === "INVENTORY_RECONCILIATION_REQUIRED" || value === "NO_PREFERRED_SUPPLIER" || value === "PREFERRED_SUPPLIER_INELIGIBLE" || value === "PREFERRED_PACKAGE_INELIGIBLE" || value === "CONSTRAINT_UNREPRESENTABLE" || value === "NOT_A_REPLENISHMENT_CANDIDATE"; }
function isSerializedDateTime(value: unknown): value is string { if (!isNonEmptyString(value)) return false; const date = new Date(value); return !Number.isNaN(date.getTime()) && date.toISOString() === value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actualKeys = Object.keys(value); return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
