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
  id: string;
  status: PurchaseStatus;
  purchaseDate: string;
  documentNumber: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  supplier: { code: string; name: string };
};

export type PurchaseListPage = {
  items: PurchaseListItem[];
  nextCursor: string | null;
};

export type PurchaseListFilters = {
  status?: PurchaseStatus;
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

export type PurchasePostingApi = Pick<ApiClient, "request">;
export type PurchaseListApi = Pick<ApiClient, "request">;

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
const PURCHASE_LIST_ITEM_KEYS = ["id", "status", "purchaseDate", "documentNumber", "postedAt", "cancelledAt", "supplier"] as const;
const PURCHASE_LIST_SUPPLIER_KEYS = ["code", "name"] as const;
const PURCHASE_LIST_PAGE_KEYS = ["items", "nextCursor"] as const;

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

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPurchaseStatus(value: unknown): value is PurchaseStatus {
  return PURCHASE_STATUSES.includes(value as PurchaseStatus);
}

function isPurchaseItem(value: unknown): value is PurchaseItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isString(item.id) &&
    typeof item.lineNumber === "number" &&
    isString(item.productId) &&
    isString(item.unitId) &&
    isString(item.quantity) &&
    isString(item.unitPrice) &&
    isString(item.taxRate) &&
    isString(item.lineAmount)
  );
}

export function isPurchase(value: unknown): value is Purchase {
  if (typeof value !== "object" || value === null) return false;
  const purchase = value as Record<string, unknown>;
  if (typeof purchase.supplier !== "object" || purchase.supplier === null) return false;
  const supplier = purchase.supplier as Record<string, unknown>;
  return (
    isString(purchase.id) &&
    isString(supplier.id) &&
    isString(supplier.code) &&
    isString(supplier.name) &&
    isPurchaseStatus(purchase.status) &&
    isString(purchase.purchaseDate) &&
    (purchase.documentNumber === null || isString(purchase.documentNumber)) &&
    (purchase.note === null || isString(purchase.note)) &&
    isString(purchase.subtotal) &&
    isString(purchase.tax) &&
    isString(purchase.total) &&
    (purchase.postedAt === null || isString(purchase.postedAt)) &&
    isString(purchase.createdAt) &&
    isString(purchase.updatedAt) &&
    Array.isArray(purchase.items) &&
    purchase.items.every(isPurchaseItem)
  );
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

export function mergePostedPurchaseResult(purchase: Purchase, posted: PostedPurchaseResult): Purchase {
  return { ...purchase, id: posted.id, postedAt: posted.postedAt, status: posted.status };
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
 * A response can be ambiguous after the request crosses the network boundary.
 * These outcomes require an explicit read before any further purchase mutation;
 * they are never an invitation to automatically post again.
 */
export function isAmbiguousPurchasePostingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.kind === "conflict" || error.kind === "server" || error.kind === "network";
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
