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

const transactionTypes = new Set<InventoryTransactionType>(["RECEIPT", "CONSUMPTION", "PRODUCTION_RECEIPT", "STOCKTAKE_ADJUSTMENT", "MANUAL_ADJUSTMENT"]);
const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

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

export async function requestInventorySupplyContext(
  api: InventorySupplyContextApi,
  productCode?: string,
  cursor?: string,
): Promise<InventorySupplyContextPage> {
  const payload = await api.request<unknown>(inventorySupplyContextPath(productCode, cursor), { expectedStatus: 200 });
  if (!isInventorySupplyContextPage(payload)) throw new ApiError("server");
  return payload;
}

export function inventoryTransactionLabel(type: InventoryTransactionType): string {
  switch (type) { case "RECEIPT": return "購入入庫"; case "CONSUMPTION": return "生産消費"; case "PRODUCTION_RECEIPT": return "生産入庫"; case "STOCKTAKE_ADJUSTMENT": return "棚卸調整"; case "MANUAL_ADJUSTMENT": return "手動調整"; }
}

export function inventoryProductStateLabel(product: InventoryProduct): string { return product.isDeleted ? "削除済み" : product.status === "ACTIVE" ? "有効" : "無効"; }

function isCurrentInventory(value: unknown): value is CurrentInventory { return isRecord(value) && hasExactlyKeys(value, ["product", "quantity", "inventoryUnit", "updatedAt"]) && isInventoryProduct(value.product) && isDecimalString(value.quantity) && isInventoryUnit(value.inventoryUnit) && isSerializedDateTime(value.updatedAt); }
function isInventoryHistory(value: unknown): value is InventoryHistory { return isRecord(value) && hasExactlyKeys(value, ["id", "type", "quantityDelta", "quantityAfter", "occurredAt", "inventoryUnit"]) && isNonEmptyString(value.id) && transactionTypes.has(value.type as InventoryTransactionType) && isDecimalString(value.quantityDelta) && isDecimalString(value.quantityAfter) && isSerializedDateTime(value.occurredAt) && isInventoryUnit(value.inventoryUnit); }
function isInventorySupplyContext(value: unknown): value is InventorySupplyContext { return isRecord(value) && hasExactlyKeys(value, ["product", "inventoryUnit", "currentQuantity", "draftPurchaseQuantity", "confirmedPurchaseQuantity"]) && isInventorySupplyProduct(value.product) && isInventoryUnit(value.inventoryUnit) && isDecimalString(value.currentQuantity) && isDecimalString(value.draftPurchaseQuantity) && isDecimalString(value.confirmedPurchaseQuantity); }
function isInventoryProduct(value: unknown): value is InventoryProduct { return isRecord(value) && hasExactlyKeys(value, ["id", "code", "name", "status", "isDeleted"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && (value.status === "ACTIVE" || value.status === "INACTIVE") && typeof value.isDeleted === "boolean"; }
function isInventorySupplyProduct(value: unknown): value is InventorySupplyProduct { return isRecord(value) && hasExactlyKeys(value, ["id", "code", "name"]) && isNonEmptyString(value.id) && isNonEmptyString(value.code) && isNonEmptyString(value.name); }
function isInventoryUnit(value: unknown): value is InventoryUnit { return isRecord(value) && hasExactlyKeys(value, ["code", "name", "symbol"]) && isNonEmptyString(value.code) && isNonEmptyString(value.name) && isNonEmptyString(value.symbol); }
function isCursor(value: unknown): value is string | null { return value === null || isNonEmptyString(value); }
function isDecimalString(value: unknown): value is string { return typeof value === "string" && decimalPattern.test(value); }
function isSerializedDateTime(value: unknown): value is string { if (!isNonEmptyString(value)) return false; const date = new Date(value); return !Number.isNaN(date.getTime()) && date.toISOString() === value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actualKeys = Object.keys(value); return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
