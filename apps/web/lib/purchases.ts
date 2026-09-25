import { ApiError, type ApiClient } from "./api-client.ts";

export const PURCHASE_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export type PurchaseItem = {
  id: string;
  lineAmount: string;
  lineNumber: number;
  productId: string;
  quantity: string;
  taxRate: string;
  unitId: string;
  unitPrice: string;
};

export type Purchase = {
  cancellationReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  documentNumber: string | null;
  id: string;
  items: PurchaseItem[];
  note: string | null;
  postedAt: string | null;
  purchaseDate: string;
  status: PurchaseStatus;
  subtotal: string;
  supplier: { code: string; id: string; name: string };
  tax: string;
  total: string;
  updatedAt: string;
};

/**
 * The list projection intentionally excludes financial values, line items,
 * notes, and inventory/price-history references. Those remain detail-only.
 */
export type PurchaseListItem = {
  correction: PurchaseListCorrectionSummary | null;
  id: string;
  status: PurchaseStatus;
  purchaseDate: string;
  documentNumber: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  supplier: { code: string; name: string };
};

/** Minimal immutable correction evidence for a POSTED purchase list row. */
export type PurchaseListCorrectionSummary = {
  id: string;
  reversedAt: string;
};

export type PurchaseListPage = {
  items: PurchaseListItem[];
  nextCursor: string | null;
};

export type PurchaseListFilters = {
  status?: PurchaseStatus;
  correction?: "corrected" | "uncorrected";
  from?: string;
  to?: string;
  supplierCode?: string;
  documentNumber?: string;
};

export type PostedPurchaseResult = {
  id: string;
  postedAt: string;
  status: "POSTED";
};

export type CancelledPurchaseResult = {
  cancellationReason: string;
  cancelledAt: string;
  id: string;
  status: "CANCELLED";
};

export type PurchaseReversalPriceResolution = {
  productId: string;
  expectedPriceMasterVersion: number;
  currentUnitPrice: string;
  currency: string;
};

export type PurchaseReversalRequest = {
  reason: string;
  previewVersion: string;
  idempotencyKey: string;
  priceResolutions: PurchaseReversalPriceResolution[];
};

export type PurchaseReversalPreview = {
  purchaseId: string;
  canReverse: boolean;
  refusalReasons: string[];
  previewVersion: string;
  existingReversal: { id: string; reversedAt: string } | null;
  inventoryEffects: Array<{
    productId: string;
    inventoryId: string | null;
    inventoryVersion: number | null;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string | null;
    averageUnitCost: string | null;
  }>;
  priceEffects: Array<{
    productId: string;
    priceMasterId: string | null;
    version: number | null;
    currentPriceHistoryId: string | null;
    currentUnitPrice: string | null;
    currency: string | null;
    source: "ORIGINAL_PURCHASE_CURRENT" | "SUBSEQUENT_PRICE_HISTORY_CURRENT" | "LEGACY_UNKNOWN_CURRENT" | "MISSING_PRICE_MASTER";
    requiresPriceResolution: boolean;
  }>;
};

export type PurchaseReversalExecution = {
  id: string;
  purchaseId: string;
  reversedAt: string;
  replayed: boolean;
};

/** An immutable readback projection; never populate this from current masters. */
export type PurchaseReversalAudit = {
  id: string;
  purchaseId: string;
  actorUserId: string;
  reason: string;
  reversedAt: string;
  items: Array<{
    purchaseItemId: string;
    productId: string;
    inventoryUnitId: string;
    quantity: string;
    unitPrice: string;
    currency: string;
  }>;
  inventoryEffects: Array<{
    productId: string;
    inventoryId: string;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string;
    averageUnitCost: string | null;
  }>;
  priceEffects: Array<{
    priceMasterId: string;
    source: "ORIGINAL_PURCHASE_CURRENT" | "SUBSEQUENT_PRICE_HISTORY_CURRENT" | "LEGACY_UNKNOWN_CURRENT";
    previousCurrentPriceHistoryId: string | null;
    previousVersion: number;
    appliedUnitPrice: string;
    appliedCurrency: string;
    effectiveAt: string;
    becomesCurrent: boolean;
    priceHistoryId: string;
  }>;
};

export type PurchaseReversalAuditResponse = { reversal: PurchaseReversalAudit | null };

export type PurchaseReversalResolutionValues = Readonly<Record<string, Readonly<{
  currentUnitPrice: string;
  currency: string;
}>>>;

export type PurchaseReversalWorkflowState =
  | { phase: "idle" }
  | { phase: "preview_loading"; reconciliation: boolean }
  | { phase: "preview_ready"; preview: PurchaseReversalPreview; canExecute: boolean }
  | { phase: "preview_error"; reconciliation: boolean }
  | { phase: "unknown_result" }
  | { phase: "completed"; purchaseId: string; reversal: { id: string; reversedAt: string } };

export type PurchasePostingApi = Pick<ApiClient, "request">;
export type PurchaseCancellationApi = Pick<ApiClient, "request">;
export type PurchaseReversalApi = Pick<ApiClient, "request">;
export type PurchaseReversalAuditApi = Pick<ApiClient, "request">;
export type PurchaseListApi = Pick<ApiClient, "request">;
export type PurchaseDraftApi = Pick<ApiClient, "request">;
export type RecommendationPurchaseHandoffApi = Pick<ApiClient, "request">;

export type PurchaseHandoffLineageSource = {
  relationshipId: string;
  supplierId: string;
  recommendedQuantity: string;
  package: { id: string; code: string; quantity: string; version: number } | null;
  commercialTerms: { id: string; version: number; unitPrice: string; currencyCode: "JPY"; taxRate: string };
};

export type RecommendationPurchaseHandoffLineage = {
  sourceRecommendationId: string;
  createdAt: string;
  purchase: { id: string; status: PurchaseStatus; purchaseDate: string };
  purchaseItem: { id: string };
  source: PurchaseHandoffLineageSource;
};

/** A Purchase can own several immutable handoff lines; never collapse this to a scalar. */
export type PurchaseHandoffLineage = {
  sourceRecommendationId: string;
  createdAt: string;
  purchaseItemId: string;
  lineNumber: number;
  source: PurchaseHandoffLineageSource;
};

export type PurchaseLineFormValues = {
  productId: string;
  quantity: string;
  rowKey: string;
  taxRate: string;
  unitId: string;
  unitPrice: string;
};

export type PurchaseFormValues = {
  documentNumber: string;
  items: PurchaseLineFormValues[];
  note: string;
  purchaseDate: string;
  supplierId: string;
};

export type PurchaseFieldErrors = Record<string, string>;

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSTED_PURCHASE_RESULT_KEYS = ["id", "status", "postedAt"] as const;
const CANCELLED_PURCHASE_RESULT_KEYS = ["id", "status", "cancelledAt", "cancellationReason"] as const;
const PURCHASE_REVERSAL_PREVIEW_KEYS = ["purchaseId", "canReverse", "refusalReasons", "previewVersion", "existingReversal", "inventoryEffects", "priceEffects"] as const;
const PURCHASE_REVERSAL_EXISTING_KEYS = ["id", "reversedAt"] as const;
const PURCHASE_REVERSAL_INVENTORY_EFFECT_KEYS = ["productId", "inventoryId", "inventoryVersion", "inventoryUnitId", "quantityDelta", "quantityAfter", "averageUnitCost"] as const;
const PURCHASE_REVERSAL_PRICE_EFFECT_KEYS = ["productId", "priceMasterId", "version", "currentPriceHistoryId", "currentUnitPrice", "currency", "source", "requiresPriceResolution"] as const;
const PURCHASE_REVERSAL_EXECUTION_KEYS = ["id", "purchaseId", "reversedAt", "replayed"] as const;
const PURCHASE_REVERSAL_AUDIT_RESPONSE_KEYS = ["reversal"] as const;
const PURCHASE_REVERSAL_AUDIT_KEYS = ["id", "purchaseId", "actorUserId", "reason", "reversedAt", "items", "inventoryEffects", "priceEffects"] as const;
const PURCHASE_REVERSAL_AUDIT_ITEM_KEYS = ["purchaseItemId", "productId", "inventoryUnitId", "quantity", "unitPrice", "currency"] as const;
const PURCHASE_REVERSAL_AUDIT_INVENTORY_EFFECT_KEYS = ["productId", "inventoryId", "inventoryUnitId", "quantityDelta", "quantityAfter", "averageUnitCost"] as const;
const PURCHASE_REVERSAL_AUDIT_PRICE_EFFECT_KEYS = ["priceMasterId", "source", "previousCurrentPriceHistoryId", "previousVersion", "appliedUnitPrice", "appliedCurrency", "effectiveAt", "becomesCurrent", "priceHistoryId"] as const;
const PURCHASE_LIST_ITEM_KEYS = ["id", "status", "purchaseDate", "documentNumber", "postedAt", "cancelledAt", "supplier", "correction"] as const;
const PURCHASE_LIST_SUPPLIER_KEYS = ["code", "name"] as const;
const PURCHASE_LIST_CORRECTION_KEYS = ["id", "reversedAt"] as const;
const PURCHASE_LIST_PAGE_KEYS = ["items", "nextCursor"] as const;
const PURCHASE_KEYS = ["id", "supplier", "status", "purchaseDate", "documentNumber", "note", "subtotal", "tax", "total", "postedAt", "cancelledAt", "cancellationReason", "createdAt", "updatedAt", "items"] as const;
const PURCHASE_SUPPLIER_KEYS = ["id", "code", "name"] as const;
const PURCHASE_ITEM_KEYS = ["id", "lineNumber", "productId", "unitId", "quantity", "unitPrice", "taxRate", "lineAmount"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_KEYS = ["purchase"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_LINEAGE_KEYS = ["handoff"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_LINEAGE_ITEM_KEYS = ["sourceRecommendationId", "createdAt", "purchase", "purchaseItem", "source"] as const;
const PURCHASE_HANDOFF_LINEAGE_KEYS = ["handoffs"] as const;
const PURCHASE_HANDOFF_LINEAGE_ITEM_KEYS = ["sourceRecommendationId", "createdAt", "purchaseItemId", "lineNumber", "source"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_PURCHASE_KEYS = ["id", "status", "purchaseDate"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_PURCHASE_ITEM_KEYS = ["id"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_SOURCE_KEYS = ["relationshipId", "supplierId", "recommendedQuantity", "package", "commercialTerms"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_PACKAGE_KEYS = ["id", "code", "quantity", "version"] as const;
const RECOMMENDATION_PURCHASE_HANDOFF_COMMERCIAL_TERMS_KEYS = ["id", "version", "unitPrice", "currencyCode", "taxRate"] as const;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isIsoTimestamp(value: unknown): value is string {
  return isCanonicalUtcTimestamp(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNormalizedCancellationReason(value: unknown): value is string {
  return isNonBlankString(value) && value === value.trim() && value.length <= 10_000;
}

function isPurchaseStatus(value: unknown): value is PurchaseStatus {
  return PURCHASE_STATUSES.includes(value as PurchaseStatus);
}

function isDecimal(value: unknown, maximumIntegerDigits: number, maximumFractionDigits: number): value is string {
  return typeof value === "string"
    && new RegExp(`^(?:0|[1-9]\\d{0,${maximumIntegerDigits - 1}})(?:\\.\\d{1,${maximumFractionDigits}})?$`).test(value);
}

function isPositiveDecimal(value: unknown, maximumIntegerDigits: number, maximumFractionDigits: number): value is string {
  return isDecimal(value, maximumIntegerDigits, maximumFractionDigits) && !/^0(?:\.0+)?$/.test(value);
}

function isTaxRate(value: unknown): value is string {
  if (!isDecimal(value, 1, 4)) return false;
  const [integer, fraction = ""] = value.split(".");
  return integer === "0" || (integer === "1" && /^0*$/.test(fraction));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNegativeDecimal(value: unknown, maximumIntegerDigits: number, maximumFractionDigits: number): value is string {
  return typeof value === "string" && value.startsWith("-") && isPositiveDecimal(value.slice(1), maximumIntegerDigits, maximumFractionDigits);
}

function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isPreviewVersion(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPurchaseItem(value: unknown): value is PurchaseItem {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_ITEM_KEYS)) return false;
  const item = value;
  return (
    isNonEmptyString(item.id) &&
    isPositiveInteger(item.lineNumber) &&
    isNonEmptyString(item.productId) &&
    isNonEmptyString(item.unitId) &&
    isPositiveDecimal(item.quantity, 15, 9) &&
    isDecimal(item.unitPrice, 14, 6) &&
    isTaxRate(item.taxRate) &&
    isDecimal(item.lineAmount, 14, 6)
  );
}

export function isPurchase(value: unknown): value is Purchase {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_KEYS)) return false;
  const purchase = value;
  if (!isRecord(purchase.supplier) || !hasExactlyKeys(purchase.supplier, PURCHASE_SUPPLIER_KEYS)) return false;
  const supplier = purchase.supplier;
  const cancellationFieldsAreValid = purchase.status === "CANCELLED"
    ? purchase.postedAt === null && isIsoTimestamp(purchase.cancelledAt) && isNormalizedCancellationReason(purchase.cancellationReason)
    : purchase.cancelledAt === null && purchase.cancellationReason === null;
  return (
    isNonEmptyString(purchase.id) &&
    isNonEmptyString(supplier.id) &&
    isNonEmptyString(supplier.code) &&
    isNonEmptyString(supplier.name) &&
    isPurchaseStatus(purchase.status) &&
    isIsoTimestamp(purchase.purchaseDate) &&
    (purchase.documentNumber === null || isString(purchase.documentNumber)) &&
    (purchase.note === null || isString(purchase.note)) &&
    isDecimal(purchase.subtotal, 14, 6) &&
    isDecimal(purchase.tax, 14, 6) &&
    isDecimal(purchase.total, 14, 6) &&
    (purchase.postedAt === null || isIsoTimestamp(purchase.postedAt)) &&
    cancellationFieldsAreValid &&
    isIsoTimestamp(purchase.createdAt) &&
    isIsoTimestamp(purchase.updatedAt) &&
    Array.isArray(purchase.items) &&
    purchase.items.every(isPurchaseItem)
  );
}

function isPurchaseReversalInventoryEffect(value: unknown): value is PurchaseReversalPreview["inventoryEffects"][number] {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_REVERSAL_INVENTORY_EFFECT_KEYS)) return false;
  return isNonBlankString(value.productId)
    && (value.inventoryId === null || isNonBlankString(value.inventoryId))
    && (value.inventoryVersion === null || isPositiveInteger(value.inventoryVersion))
    && isNonBlankString(value.inventoryUnitId)
    && isNegativeDecimal(value.quantityDelta, 15, 9)
    && (value.quantityAfter === null || isDecimal(value.quantityAfter, 15, 9))
    && (value.averageUnitCost === null || isDecimal(value.averageUnitCost, 14, 6))
    && ((value.inventoryId === null && value.inventoryVersion === null && value.quantityAfter === null)
      || (isNonBlankString(value.inventoryId) && isPositiveInteger(value.inventoryVersion) && isDecimal(value.quantityAfter, 15, 9)));
}

function isPurchaseReversalPriceEffect(value: unknown): value is PurchaseReversalPreview["priceEffects"][number] {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_REVERSAL_PRICE_EFFECT_KEYS)) return false;
  if (!isNonBlankString(value.productId) || typeof value.requiresPriceResolution !== "boolean") return false;
  if (value.source === "MISSING_PRICE_MASTER") {
    return value.priceMasterId === null
      && value.version === null
      && value.currentPriceHistoryId === null
      && value.currentUnitPrice === null
      && value.currency === null
      && value.requiresPriceResolution === false;
  }
  if (value.source !== "ORIGINAL_PURCHASE_CURRENT"
    && value.source !== "SUBSEQUENT_PRICE_HISTORY_CURRENT"
    && value.source !== "LEGACY_UNKNOWN_CURRENT") return false;
  return isNonBlankString(value.priceMasterId)
    && isPositiveInteger(value.version)
    && (value.currentPriceHistoryId === null || isNonBlankString(value.currentPriceHistoryId))
    && isDecimal(value.currentUnitPrice, 14, 6)
    && isCurrency(value.currency)
    && value.requiresPriceResolution === (value.source !== "SUBSEQUENT_PRICE_HISTORY_CURRENT");
}

export function isPurchaseReversalPreview(value: unknown): value is PurchaseReversalPreview {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_REVERSAL_PREVIEW_KEYS)) return false;
  if (!isNonBlankString(value.purchaseId)
    || typeof value.canReverse !== "boolean"
    || !Array.isArray(value.refusalReasons)
    || !value.refusalReasons.every(isNonBlankString)
    || new Set(value.refusalReasons).size !== value.refusalReasons.length
    || !isPreviewVersion(value.previewVersion)
    || !Array.isArray(value.inventoryEffects)
    || !value.inventoryEffects.every(isPurchaseReversalInventoryEffect)
    || !Array.isArray(value.priceEffects)
    || !value.priceEffects.every(isPurchaseReversalPriceEffect)) return false;
  if (value.existingReversal !== null && (!isRecord(value.existingReversal)
    || !hasExactlyKeys(value.existingReversal, PURCHASE_REVERSAL_EXISTING_KEYS)
    || !isNonBlankString(value.existingReversal.id)
    || !isIsoTimestamp(value.existingReversal.reversedAt))) return false;
  const inventoryProductIds = value.inventoryEffects.map((effect) => effect.productId);
  const priceProductIds = value.priceEffects.map((effect) => effect.productId);
  if (new Set(inventoryProductIds).size !== inventoryProductIds.length
    || new Set(priceProductIds).size !== priceProductIds.length
    || inventoryProductIds.length !== priceProductIds.length
    || !inventoryProductIds.every((productId) => priceProductIds.includes(productId))) return false;
  return value.canReverse === (value.refusalReasons.length === 0)
    && (value.existingReversal === null || value.canReverse === false);
}

export function isPurchaseReversalRequest(value: unknown): value is PurchaseReversalRequest {
  if (!isRecord(value) || !hasExactlyKeys(value, ["reason", "previewVersion", "idempotencyKey", "priceResolutions"])) return false;
  if (!isNormalizedCancellationReason(value.reason) || !isPreviewVersion(value.previewVersion) || !isUuidV4(value.idempotencyKey)
    || !Array.isArray(value.priceResolutions) || value.priceResolutions.length > 1_000) return false;
  const productIds = new Set<string>();
  return value.priceResolutions.every((resolution) => {
    if (!isRecord(resolution)
      || !hasExactlyKeys(resolution, ["productId", "expectedPriceMasterVersion", "currentUnitPrice", "currency"])
      || !isNonBlankString(resolution.productId)
      || !isPositiveInteger(resolution.expectedPriceMasterVersion)
      || !isDecimal(resolution.currentUnitPrice, 14, 6)
      || !isCurrency(resolution.currency)
      || productIds.has(resolution.productId)) return false;
    productIds.add(resolution.productId);
    return true;
  });
}

export function isPurchaseReversalExecution(value: unknown, purchaseId: string): value is PurchaseReversalExecution {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_REVERSAL_EXECUTION_KEYS)
    && isNonBlankString(value.id)
    && value.purchaseId === purchaseId
    && isIsoTimestamp(value.reversedAt)
    && typeof value.replayed === "boolean";
}

function isStrictlyAscending(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}

function isPurchaseReversalAuditItem(value: unknown): value is PurchaseReversalAudit["items"][number] {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_REVERSAL_AUDIT_ITEM_KEYS)
    && isNonBlankString(value.purchaseItemId)
    && isNonBlankString(value.productId)
    && isNonBlankString(value.inventoryUnitId)
    && isPositiveDecimal(value.quantity, 15, 9)
    && isDecimal(value.unitPrice, 14, 6)
    && isCurrency(value.currency);
}

function isPurchaseReversalAuditInventoryEffect(value: unknown): value is PurchaseReversalAudit["inventoryEffects"][number] {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_REVERSAL_AUDIT_INVENTORY_EFFECT_KEYS)
    && isNonBlankString(value.productId)
    && isNonBlankString(value.inventoryId)
    && isNonBlankString(value.inventoryUnitId)
    && isNegativeDecimal(value.quantityDelta, 15, 9)
    && isDecimal(value.quantityAfter, 15, 9)
    && (value.averageUnitCost === null || isDecimal(value.averageUnitCost, 14, 6));
}

function isPurchaseReversalAuditPriceEffect(value: unknown): value is PurchaseReversalAudit["priceEffects"][number] {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_REVERSAL_AUDIT_PRICE_EFFECT_KEYS)
    && isNonBlankString(value.priceMasterId)
    && (value.source === "ORIGINAL_PURCHASE_CURRENT"
      || value.source === "SUBSEQUENT_PRICE_HISTORY_CURRENT"
      || value.source === "LEGACY_UNKNOWN_CURRENT")
    && (value.previousCurrentPriceHistoryId === null || isNonBlankString(value.previousCurrentPriceHistoryId))
    && isPositiveInteger(value.previousVersion)
    && isDecimal(value.appliedUnitPrice, 14, 6)
    && isCurrency(value.appliedCurrency)
    && isIsoTimestamp(value.effectiveAt)
    && typeof value.becomesCurrent === "boolean"
    && isNonBlankString(value.priceHistoryId);
}

export function isPurchaseReversalAuditResponse(value: unknown): value is PurchaseReversalAuditResponse {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_REVERSAL_AUDIT_RESPONSE_KEYS)) return false;
  if (value.reversal === null) return true;
  if (!isRecord(value.reversal) || !hasExactlyKeys(value.reversal, PURCHASE_REVERSAL_AUDIT_KEYS)) return false;
  const reversal = value.reversal;
  if (!isNonBlankString(reversal.id)
    || !isNonBlankString(reversal.purchaseId)
    || !isNonBlankString(reversal.actorUserId)
    || !isNormalizedCancellationReason(reversal.reason)
    || !isIsoTimestamp(reversal.reversedAt)
    || !Array.isArray(reversal.items)
    || !reversal.items.every(isPurchaseReversalAuditItem)
    || !Array.isArray(reversal.inventoryEffects)
    || !reversal.inventoryEffects.every(isPurchaseReversalAuditInventoryEffect)
    || !Array.isArray(reversal.priceEffects)
    || !reversal.priceEffects.every(isPurchaseReversalAuditPriceEffect)) return false;

  const items = reversal.items as PurchaseReversalAudit["items"];
  const inventoryEffects = reversal.inventoryEffects as PurchaseReversalAudit["inventoryEffects"];
  const priceEffects = reversal.priceEffects as PurchaseReversalAudit["priceEffects"];
  if (!isStrictlyAscending(items.map((item) => item.purchaseItemId))) return false;
  if (!inventoryEffects.every((effect, index) => {
    if (index === 0) return true;
    const previous = inventoryEffects[index - 1]!;
    return previous.productId < effect.productId
      || (previous.productId === effect.productId && previous.inventoryId < effect.inventoryId);
  })) return false;
  if (new Set(inventoryEffects.map((effect) => effect.productId)).size !== inventoryEffects.length
    || new Set(inventoryEffects.map((effect) => effect.inventoryId)).size !== inventoryEffects.length) return false;
  return isStrictlyAscending(priceEffects.map((effect) => effect.priceMasterId));
}

export async function requestPurchaseDetail(api: PurchaseDraftApi, purchaseId: string): Promise<Purchase> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}`, { expectedStatus: 200 });
  if (!isPurchase(payload)) throw new ApiError("server");
  return payload;
}

export async function createPurchaseDraft(api: PurchaseDraftApi, payload: ReturnType<typeof purchasePayload>): Promise<Purchase> {
  const response = await api.request<unknown>("/purchases", { method: "POST", body: payload, expectedStatus: 201 });
  if (!isPurchase(response)) throw new ApiError("server");
  return response;
}

export async function updatePurchaseDraft(api: PurchaseDraftApi, purchaseId: string, payload: ReturnType<typeof purchasePayload>): Promise<Purchase> {
  const response = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}`, { method: "PATCH", body: payload, expectedStatus: 200 });
  if (!isPurchase(response)) throw new ApiError("server");
  return response;
}

export async function confirmPurchaseDraft(api: PurchaseDraftApi, purchaseId: string): Promise<Purchase> {
  const response = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}/confirm`, { method: "POST", expectedStatus: 201 });
  if (!isPurchase(response)) throw new ApiError("server");
  return response;
}

/**
 * This endpoint has two intentional success outcomes: the first request
 * creates the immutable-provenance draft (201); a retry returns that exact
 * same draft (200). No client fields other than the business purchase date
 * participate in handoff, and the server remains authoritative for every line.
 */
export async function createPurchaseDraftFromRecommendation(
  api: RecommendationPurchaseHandoffApi,
  recommendationId: string,
  purchaseDate: string,
): Promise<Purchase> {
  const response = await api.request<unknown>(
    `/purchases/replenishment-recommendations/${encodeURIComponent(recommendationId)}/draft`,
    { method: "POST", body: { purchaseDate }, expectedStatus: [200, 201] },
  );
  if (!isRecommendationPurchaseHandoffResponse(response)) throw new ApiError("server");
  return response.purchase;
}

export function isRecommendationPurchaseHandoffResponse(value: unknown): value is { purchase: Purchase } {
  return isRecord(value)
    && hasExactlyKeys(value, RECOMMENDATION_PURCHASE_HANDOFF_KEYS)
    && isPurchase(value.purchase);
}

/**
 * A passive lineage lookup is deliberately separate from the handoff POST.
 * It must never create or replay a Purchase merely to render UI state.
 */
export async function requestRecommendationPurchaseHandoffLineage(
  api: RecommendationPurchaseHandoffApi,
  recommendationId: string,
): Promise<RecommendationPurchaseHandoffLineage | null> {
  const response = await api.request<unknown>(
    `/purchases/replenishment-recommendations/${encodeURIComponent(recommendationId)}/handoff`,
    { expectedStatus: 200 },
  );
  if (!isRecommendationPurchaseHandoffLineageResponse(response)) throw new ApiError("server");
  return response.handoff;
}

export function isRecommendationPurchaseHandoffLineageResponse(value: unknown): value is { handoff: RecommendationPurchaseHandoffLineage | null } {
  return isRecord(value)
    && hasExactlyKeys(value, RECOMMENDATION_PURCHASE_HANDOFF_LINEAGE_KEYS)
    && (value.handoff === null || isRecommendationPurchaseHandoffLineage(value.handoff));
}

/**
 * This passive read is the only Purchase-origin lineage authority. It never
 * calls the handoff mutation, so rendering a manual Purchase cannot create or
 * replay a draft as a side effect.
 */
export async function requestPurchaseHandoffLineage(
  api: RecommendationPurchaseHandoffApi,
  purchaseId: string,
): Promise<PurchaseHandoffLineage[]> {
  const response = await api.request<unknown>(
    `/purchases/${encodeURIComponent(purchaseId)}/handoff-lineage`,
    { expectedStatus: 200 },
  );
  if (!isPurchaseHandoffLineageResponse(response)) throw new ApiError("server");
  return response.handoffs;
}

export function isPurchaseHandoffLineageResponse(value: unknown): value is { handoffs: PurchaseHandoffLineage[] } {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_HANDOFF_LINEAGE_KEYS) || !Array.isArray(value.handoffs)) return false;
  if (!value.handoffs.every(isPurchaseHandoffLineage)) return false;
  const sourceRecommendationIds = new Set<string>();
  const purchaseItemIds = new Set<string>();
  for (let index = 0; index < value.handoffs.length; index += 1) {
    const current = value.handoffs[index]!;
    if (sourceRecommendationIds.has(current.sourceRecommendationId) || purchaseItemIds.has(current.purchaseItemId)) return false;
    sourceRecommendationIds.add(current.sourceRecommendationId);
    purchaseItemIds.add(current.purchaseItemId);
    const previous = value.handoffs[index - 1];
    if (previous !== undefined && (
      current.lineNumber < previous.lineNumber
      || (current.lineNumber === previous.lineNumber && current.purchaseItemId <= previous.purchaseItemId)
    )) return false;
  }
  return true;
}

function isRecommendationPurchaseHandoffLineage(value: unknown): value is RecommendationPurchaseHandoffLineage {
  if (!isRecord(value) || !hasExactlyKeys(value, RECOMMENDATION_PURCHASE_HANDOFF_LINEAGE_ITEM_KEYS)) return false;
  if (!isRecord(value.purchase) || !hasExactlyKeys(value.purchase, RECOMMENDATION_PURCHASE_HANDOFF_PURCHASE_KEYS)) return false;
  if (!isRecord(value.purchaseItem) || !hasExactlyKeys(value.purchaseItem, RECOMMENDATION_PURCHASE_HANDOFF_PURCHASE_ITEM_KEYS)) return false;
  if (!isHandoffLineageSource(value.source)) return false;
  const source = value.source;
  return (
    isNonEmptyString(value.sourceRecommendationId)
    && isIsoTimestamp(value.createdAt)
    && isNonEmptyString(value.purchase.id)
    && isPurchaseStatus(value.purchase.status)
    && isIsoTimestamp(value.purchase.purchaseDate)
    && isNonEmptyString(value.purchaseItem.id)
    && isHandoffLineageSource(source)
  );
}

function isPurchaseHandoffLineage(value: unknown): value is PurchaseHandoffLineage {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_HANDOFF_LINEAGE_ITEM_KEYS)
    && isNonEmptyString(value.sourceRecommendationId)
    && isIsoTimestamp(value.createdAt)
    && isNonEmptyString(value.purchaseItemId)
    && isPositiveInteger(value.lineNumber)
    && isHandoffLineageSource(value.source);
}

function isHandoffLineageSource(value: unknown): value is PurchaseHandoffLineageSource {
  if (!isRecord(value) || !hasExactlyKeys(value, RECOMMENDATION_PURCHASE_HANDOFF_SOURCE_KEYS)) return false;
  if (!isRecord(value.commercialTerms) || !hasExactlyKeys(value.commercialTerms, RECOMMENDATION_PURCHASE_HANDOFF_COMMERCIAL_TERMS_KEYS)) return false;
  if (value.package !== null && (!isRecord(value.package) || !hasExactlyKeys(value.package, RECOMMENDATION_PURCHASE_HANDOFF_PACKAGE_KEYS))) return false;
  return (
    isNonEmptyString(value.relationshipId)
    && isNonEmptyString(value.supplierId)
    && isPositiveDecimal(value.recommendedQuantity, 15, 9)
    && (value.package === null || (
      isNonEmptyString(value.package.id)
      && isNonEmptyString(value.package.code)
      && isPositiveDecimal(value.package.quantity, 15, 9)
      && isPositiveInteger(value.package.version)
    ))
    && isNonEmptyString(value.commercialTerms.id)
    && isPositiveInteger(value.commercialTerms.version)
    && isDecimal(value.commercialTerms.unitPrice, 14, 6)
    && value.commercialTerms.currencyCode === "JPY"
    && isTaxRate(value.commercialTerms.taxRate)
  );
}

function isPurchaseListCorrectionSummary(value: unknown): value is PurchaseListCorrectionSummary {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_LIST_CORRECTION_KEYS)
    && isNonBlankString(value.id)
    && isIsoTimestamp(value.reversedAt);
}

function isPurchaseListItem(value: unknown): value is PurchaseListItem {
  if (!isRecord(value) || !hasExactlyKeys(value, PURCHASE_LIST_ITEM_KEYS)) return false;
  if (!isRecord(value.supplier) || !hasExactlyKeys(value.supplier, PURCHASE_LIST_SUPPLIER_KEYS)) return false;
  return (
    isNonEmptyString(value.id)
    && isPurchaseStatus(value.status)
    && isIsoTimestamp(value.purchaseDate)
    && (value.documentNumber === null || isString(value.documentNumber))
    && (value.postedAt === null || isIsoTimestamp(value.postedAt))
    && (value.cancelledAt === null || isIsoTimestamp(value.cancelledAt))
    && isNonEmptyString(value.supplier.code)
    && isNonEmptyString(value.supplier.name)
    && (value.correction === null || isPurchaseListCorrectionSummary(value.correction))
    && (value.correction === null || value.status === "POSTED")
  );
}

/**
 * The operational list is a Lotus-owned API trust boundary. Any unexpected
 * status/body shape must leave the UI in an error state rather than rendering
 * a partial or potentially stale list.
 */
export function isPurchaseListPage(value: unknown): value is PurchaseListPage {
  return isRecord(value)
    && hasExactlyKeys(value, PURCHASE_LIST_PAGE_KEYS)
    && Array.isArray(value.items)
    && value.items.every(isPurchaseListItem)
    && (value.nextCursor === null || isNonEmptyString(value.nextCursor));
}

export function purchaseListPath(filters: PurchaseListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  query.set("limit", "50");
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.correction !== undefined) query.set("correction", filters.correction);
  if (filters.from !== undefined && filters.from.length > 0) query.set("from", filters.from);
  if (filters.to !== undefined && filters.to.length > 0) query.set("to", filters.to);
  if (filters.supplierCode !== undefined && filters.supplierCode.length > 0) query.set("supplierCode", filters.supplierCode);
  if (filters.documentNumber !== undefined && filters.documentNumber.length > 0) query.set("documentNumber", filters.documentNumber);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/purchases?${query.toString()}`;
}

export async function requestPurchaseList(
  api: PurchaseListApi,
  filters: PurchaseListFilters,
  cursor?: string,
): Promise<PurchaseListPage> {
  const payload = await api.request<unknown>(purchaseListPath(filters, cursor), { expectedStatus: 200 });
  if (!isPurchaseListPage(payload)) throw new ApiError("server");
  return payload;
}

/**
 * The posting endpoint deliberately returns only these lifecycle fields. The
 * response is authoritative only when it exactly matches the existing API
 * contract; callers must not infer inventory, pricing, or accounting details.
 */
export function isPostedPurchaseResult(value: unknown, purchaseId: string): value is PostedPurchaseResult {
  return isRecord(value)
    && hasExactlyKeys(value, POSTED_PURCHASE_RESULT_KEYS)
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && value.id === purchaseId
    && value.status === "POSTED"
    && isIsoTimestamp(value.postedAt);
}

export function isCancelledPurchaseResult(value: unknown, purchaseId: string): value is CancelledPurchaseResult {
  return isRecord(value)
    && hasExactlyKeys(value, CANCELLED_PURCHASE_RESULT_KEYS)
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && value.id === purchaseId
    && value.status === "CANCELLED"
    && isIsoTimestamp(value.cancelledAt)
    && isNormalizedCancellationReason(value.cancellationReason);
}

export function mergePostedPurchaseResult(purchase: Purchase, posted: PostedPurchaseResult): Purchase {
  return { ...purchase, id: posted.id, postedAt: posted.postedAt, status: posted.status };
}

export function mergeCancelledPurchaseResult(purchase: Purchase, cancelled: CancelledPurchaseResult): Purchase {
  return {
    ...purchase,
    id: cancelled.id,
    status: cancelled.status,
    postedAt: null,
    cancelledAt: cancelled.cancelledAt,
    cancellationReason: cancelled.cancellationReason,
  };
}

/**
 * A valid posting response is the lifecycle authority. In particular, do not
 * add a read-after-write request here: a later read failure must never make a
 * committed inventory/price posting look retryable.
 */
export async function requestPurchasePosting(
  api: PurchasePostingApi,
  purchase: Purchase,
): Promise<Purchase> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchase.id)}/post`, {
    method: "POST",
    expectedStatus: 200,
  });
  if (!isPostedPurchaseResult(payload, purchase.id)) throw new ApiError("server");
  return mergePostedPurchaseResult(purchase, payload);
}

/**
 * Cancellation is terminal and the exact 200 response is the lifecycle
 * authority. A caller must never infer a successful cancellation from a
 * follow-up read or retry after an ambiguous transport outcome.
 */
export async function requestPurchaseCancellation(
  api: PurchaseCancellationApi,
  purchase: Purchase,
  reason: string,
): Promise<Purchase> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchase.id)}/cancel`, {
    method: "POST",
    body: { reason },
    expectedStatus: 200,
  });
  if (!isCancelledPurchaseResult(payload, purchase.id)) throw new ApiError("server");
  return mergeCancelledPurchaseResult(purchase, payload);
}

/** The preview is read-only and is the only authority for reversal state. */
export async function requestPurchaseReversalPreview(
  api: PurchaseReversalApi,
  purchaseId: string,
): Promise<PurchaseReversalPreview> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}/reversal-preview`, {
    expectedStatus: 200,
  });
  if (!isPurchaseReversalPreview(payload)) throw new ApiError("server");
  if (payload.purchaseId !== purchaseId) throw new ApiError("server");
  return payload;
}

/** This read is audit-only and must never participate in reversal execution. */
export async function requestPurchaseReversalAudit(
  api: PurchaseReversalAuditApi,
  purchaseId: string,
): Promise<PurchaseReversalAudit | null> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}/reversal`, {
    expectedStatus: 200,
  });
  if (!isPurchaseReversalAuditResponse(payload)) throw new ApiError("server");
  if (payload.reversal !== null && payload.reversal.purchaseId !== purchaseId) throw new ApiError("server");
  return payload.reversal;
}

/**
 * Build the write payload solely from one preview. In particular, the
 * PriceMaster version is never read again or recomputed by the browser.
 */
export function createPurchaseReversalRequest(
  preview: PurchaseReversalPreview,
  reason: string,
  idempotencyKey: string,
  resolutionValues: PurchaseReversalResolutionValues,
): PurchaseReversalRequest {
  const requiredEffects = preview.priceEffects.filter((effect) => effect.requiresPriceResolution);
  const requiredProductIds = new Set(requiredEffects.map((effect) => effect.productId));
  const suppliedProductIds = Object.keys(resolutionValues);
  if (suppliedProductIds.length !== requiredProductIds.size || suppliedProductIds.some((productId) => !requiredProductIds.has(productId))) {
    throw new ApiError("validation");
  }
  const priceResolutions = requiredEffects.map((effect) => {
    const values = resolutionValues[effect.productId];
    if (values === undefined || effect.version === null) throw new ApiError("validation");
    return {
      productId: effect.productId,
      expectedPriceMasterVersion: effect.version,
      currentUnitPrice: values.currentUnitPrice,
      currency: values.currency,
    };
  });
  const request = {
    reason: reason.trim(),
    previewVersion: preview.previewVersion,
    idempotencyKey,
    priceResolutions,
  };
  if (!isPurchaseReversalRequest(request)) throw new ApiError("validation");
  return request;
}

/** Both a first write and the server's idempotent replay are successful. */
export async function requestPurchaseReversal(
  api: PurchaseReversalApi,
  purchaseId: string,
  request: PurchaseReversalRequest,
): Promise<PurchaseReversalExecution> {
  if (!isPurchaseReversalRequest(request)) throw new ApiError("validation");
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}/reversals`, {
    method: "POST",
    body: request,
    expectedStatus: [200, 201],
  });
  if (!isPurchaseReversalExecution(payload, purchaseId)) throw new ApiError("server");
  return payload;
}

export function startPurchaseReversalPreview(reconciliation: boolean): PurchaseReversalWorkflowState {
  return { phase: "preview_loading", reconciliation };
}

export function settlePurchaseReversalPreview(
  preview: PurchaseReversalPreview,
  canExecute: boolean,
): PurchaseReversalWorkflowState {
  if (preview.existingReversal !== null) {
    return { phase: "completed", purchaseId: preview.purchaseId, reversal: preview.existingReversal };
  }
  return { phase: "preview_ready", preview, canExecute };
}

export function failPurchaseReversalPreview(reconciliation: boolean): PurchaseReversalWorkflowState {
  return { phase: "preview_error", reconciliation };
}

export function markPurchaseReversalUnknown(): PurchaseReversalWorkflowState {
  return { phase: "unknown_result" };
}

export function completePurchaseReversal(execution: PurchaseReversalExecution): PurchaseReversalWorkflowState {
  return { phase: "completed", purchaseId: execution.purchaseId, reversal: { id: execution.id, reversedAt: execution.reversedAt } };
}

export function canStartPurchaseReversal(
  purchase: Pick<Purchase, "status">,
  hasReversePermission: boolean,
  state: PurchaseReversalWorkflowState,
): boolean {
  return purchase.status === "POSTED" && hasReversePermission && state.phase === "idle";
}

export function canExecutePurchaseReversal(state: PurchaseReversalWorkflowState): boolean {
  return state.phase === "preview_ready" && state.canExecute && state.preview.canReverse && state.preview.existingReversal === null;
}

export function canSubmitPurchaseReversal(state: PurchaseReversalWorkflowState, isSubmitting: boolean): boolean {
  return !isSubmitting && canExecutePurchaseReversal(state);
}

/**
 * A response can be ambiguous after the request crosses the network boundary.
 * These outcomes require an explicit read before any further purchase mutation;
 * they are never an invitation to automatically post again.
 */
export function isAmbiguousPurchasePostingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.kind === "conflict" || error.kind === "server" || error.kind === "network";
}

export function isAmbiguousPurchaseCancellationError(error: unknown): boolean {
  return isAmbiguousPurchasePostingError(error);
}

/**
 * A mutation outcome is reconcilable only after a fresh preview. This includes
 * 409 because the client intentionally does not infer which conflict occurred.
 */
export function isAmbiguousPurchaseReversalError(error: unknown): boolean {
  return isAmbiguousPurchasePostingError(error);
}

export function emptyPurchaseLine(rowKey: string): PurchaseLineFormValues {
  return { productId: "", quantity: "", rowKey, taxRate: "0", unitId: "", unitPrice: "" };
}

export function emptyPurchaseForm(rowKey: string): PurchaseFormValues {
  return { documentNumber: "", items: [emptyPurchaseLine(rowKey)], note: "", purchaseDate: "", supplierId: "" };
}

// Row keys are browser-only identities. Server item IDs are intentionally never
// copied into form state or into a create/update payload.
export function purchaseFormFromPurchase(purchase: Purchase): PurchaseFormValues {
  return {
    supplierId: purchase.supplier.id,
    purchaseDate: purchase.purchaseDate.slice(0, 10),
    documentNumber: purchase.documentNumber ?? "",
    note: purchase.note ?? "",
    items: purchase.items.map((item, index) => ({
      rowKey: `purchase-line-${index + 1}`,
      productId: item.productId,
      unitId: item.unitId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      taxRate: item.taxRate,
    })),
  };
}

function required(value: string, label: string, errors: PurchaseFieldErrors, field: string): void {
  if (value.trim().length === 0) errors[field] = `${label}を入力または選択してください。`;
}

function decimalError(value: string, label: string, errors: PurchaseFieldErrors, field: string): void {
  if (!DECIMAL_PATTERN.test(value.trim())) errors[field] = `${label}は0以上の10進数で入力してください。`;
}

function decimalIsZero(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

function decimalIsGreaterThanOne(value: string): boolean {
  const [integer, fraction = ""] = value.split(".");
  if (integer === undefined || integer === "0") return false;
  if (integer !== "1") return true;
  return !decimalIsZero(`0.${fraction}`);
}

export function validatePurchaseForm(values: PurchaseFormValues): PurchaseFieldErrors {
  const errors: PurchaseFieldErrors = {};
  required(values.supplierId, "仕入先", errors, "supplierId");
  required(values.purchaseDate, "仕入日", errors, "purchaseDate");
  if (values.purchaseDate.length > 0 && !ISO_DATE_PATTERN.test(values.purchaseDate)) {
    errors.purchaseDate = "仕入日は YYYY-MM-DD 形式で入力してください。";
  }

  if (values.items.length === 0) {
    errors.items = "仕入明細を1件以上追加してください。";
  }

  values.items.forEach((item) => {
    const prefix = `items.${item.rowKey}`;
    required(item.productId, "商品", errors, `${prefix}.productId`);
    required(item.unitId, "単位", errors, `${prefix}.unitId`);
    decimalError(item.quantity, "数量", errors, `${prefix}.quantity`);
    if (DECIMAL_PATTERN.test(item.quantity.trim()) && decimalIsZero(item.quantity.trim())) {
      errors[`${prefix}.quantity`] = "数量は0より大きい値を入力してください。";
    }
    decimalError(item.unitPrice, "単価", errors, `${prefix}.unitPrice`);
    decimalError(item.taxRate, "税率", errors, `${prefix}.taxRate`);
    if (DECIMAL_PATTERN.test(item.taxRate.trim()) && decimalIsGreaterThanOne(item.taxRate.trim())) {
      errors[`${prefix}.taxRate`] = "税率は0から1までの値を入力してください。";
    }
  });

  return errors;
}

// Decimal input remains a string from the form to JSON. Do not parse or round it
// in the browser: the API/DB own monetary and quantity calculations.
export function purchasePayload(values: PurchaseFormValues) {
  const documentNumber = values.documentNumber.trim();
  const note = values.note.trim();
  return {
    supplierId: values.supplierId,
    purchaseDate: values.purchaseDate,
    documentNumber: documentNumber.length === 0 ? undefined : documentNumber,
    note: note.length === 0 ? undefined : note,
    items: values.items.map((item) => ({
      productId: item.productId,
      unitId: item.unitId,
      quantity: item.quantity.trim(),
      unitPrice: item.unitPrice.trim(),
      taxRate: item.taxRate.trim(),
    })),
  };
}

export function purchaseStatusLabel(status: PurchaseStatus): string {
  switch (status) {
    case "DRAFT": return "下書き";
    case "CONFIRMED": return "確認済み";
    case "POSTED": return "計上済み";
    case "CANCELLED": return "取消済み";
  }
}

export function formatPurchaseDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(date);
}

export function formatPurchaseTimestamp(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
