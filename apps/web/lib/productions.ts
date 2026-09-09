import { ApiError, type ApiClient } from "./api-client.ts";

export const PRODUCTION_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export type ProductionConsumption = {
  amountSnapshot: string;
  conversionFactorSnapshot: string;
  currency: string;
  id: string;
  inventoryQuantity: string;
  inventoryUnitId: string;
  lineNumber: number;
  productId: string;
  recipeQuantitySnapshot: string;
  recipeUnitId: string;
  unitCostSnapshot: string;
};

export type Production = {
  actualQuantity: string | null;
  cancelledAt: string | null;
  consumptions: ProductionConsumption[];
  createdAt: string;
  id: string;
  note: string | null;
  output: {
    conversionFactor: string;
    productId: string;
    unitId: string;
    yieldQuantity: string;
  };
  plannedQuantity: string;
  postedAt: string | null;
  productionDate: string;
  recipe: { id: string; revision: number; rootRecipeId: string };
  status: ProductionStatus;
  updatedAt: string;
};

/**
 * List entries contain only Production-owned identifiers and lifecycle data.
 * Product and Recipe master values are intentionally not fetched or exposed.
 */
export type ProductionListItem = {
  id: string;
  status: ProductionStatus;
  productionDate: string;
  outputProductIdSnapshot: string;
  recipe: { id: string; rootRecipeId: string; revision: number };
  postedAt: string | null;
  cancelledAt: string | null;
};

export type ProductionListPage = {
  items: ProductionListItem[];
  nextCursor: string | null;
};

export type ProductionListFilters = {
  status?: ProductionStatus;
  from?: string;
  to?: string;
  recipeId?: string;
  outputProductIdSnapshot?: string;
};

export type PostedProductionResult = {
  actualQuantity: string;
  id: string;
  postedAt: string;
  status: "POSTED";
};

export type ProductionPostingApi = Pick<ApiClient, "request">;
export type ProductionListApi = Pick<ApiClient, "request">;

export type ActiveRecipe = {
  id: string;
  items: Array<{ id: string; productId: string; quantity: string; sortOrder: number; unitId: string }>;
  name: string;
  note: string | null;
  outputProductId: string;
  revision: number;
  rootRecipeId: string;
  status: "ACTIVE";
  yieldQuantity: string;
  yieldUnitId: string;
};

export type ProductionFormValues = {
  note: string;
  plannedQuantity: string;
  productionDate: string;
};

export type ProductionCreateValues = ProductionFormValues & { recipeId: string };
export type ProductionFieldErrors = Record<string, string>;

const DECIMAL_24_9 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/;
const POST_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const DECIMAL_RESPONSE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const POSTED_PRODUCTION_RESULT_KEYS = ["id", "status", "postedAt", "actualQuantity"] as const;
const PRODUCTION_LIST_ITEM_KEYS = ["id", "status", "productionDate", "outputProductIdSnapshot", "recipe", "postedAt", "cancelledAt"] as const;
const PRODUCTION_LIST_RECIPE_KEYS = ["id", "rootRecipeId", "revision"] as const;
const PRODUCTION_LIST_PAGE_KEYS = ["items", "nextCursor"] as const;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isString(value)) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isProductionStatus(value: unknown): value is ProductionStatus {
  return PRODUCTION_STATUSES.includes(value as ProductionStatus);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isDecimalString(value: unknown): value is string {
  return isString(value) && DECIMAL_RESPONSE.test(value);
}

function isProductionConsumption(value: unknown): value is ProductionConsumption {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    Number.isInteger(value.lineNumber) &&
    isString(value.productId) &&
    isDecimalString(value.recipeQuantitySnapshot) &&
    isString(value.recipeUnitId) &&
    isDecimalString(value.inventoryQuantity) &&
    isString(value.inventoryUnitId) &&
    isDecimalString(value.conversionFactorSnapshot) &&
    isDecimalString(value.unitCostSnapshot) &&
    isDecimalString(value.amountSnapshot) &&
    isString(value.currency)
  );
}

export function isProduction(value: unknown): value is Production {
  if (!isRecord(value) || !isRecord(value.recipe) || !isRecord(value.output)) return false;
  return (
    isString(value.id) &&
    isProductionStatus(value.status) &&
    isString(value.recipe.id) &&
    isString(value.recipe.rootRecipeId) &&
    Number.isInteger(value.recipe.revision) &&
    isString(value.productionDate) &&
    isDecimalString(value.plannedQuantity) &&
    (value.actualQuantity === null || isDecimalString(value.actualQuantity)) &&
    isNullableString(value.note) &&
    isNullableString(value.postedAt) &&
    isNullableString(value.cancelledAt) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isString(value.output.productId) &&
    isDecimalString(value.output.yieldQuantity) &&
    isString(value.output.unitId) &&
    isDecimalString(value.output.conversionFactor) &&
    Array.isArray(value.consumptions) &&
    value.consumptions.every(isProductionConsumption)
  );
}

function isProductionListItem(value: unknown): value is ProductionListItem {
  if (!isPlainRecord(value) || !hasExactlyKeys(value, PRODUCTION_LIST_ITEM_KEYS)) return false;
  if (!isPlainRecord(value.recipe) || !hasExactlyKeys(value.recipe, PRODUCTION_LIST_RECIPE_KEYS)) return false;
  return (
    isNonEmptyString(value.id)
    && isProductionStatus(value.status)
    && isIsoTimestamp(value.productionDate)
    && isNonEmptyString(value.outputProductIdSnapshot)
    && isNonEmptyString(value.recipe.id)
    && isNonEmptyString(value.recipe.rootRecipeId)
    && isPositiveInteger(value.recipe.revision)
    && (value.postedAt === null || isIsoTimestamp(value.postedAt))
    && (value.cancelledAt === null || isIsoTimestamp(value.cancelledAt))
  );
}

/** The list response is an operational API trust boundary. */
export function isProductionListPage(value: unknown): value is ProductionListPage {
  return isPlainRecord(value)
    && hasExactlyKeys(value, PRODUCTION_LIST_PAGE_KEYS)
    && Array.isArray(value.items)
    && value.items.every(isProductionListItem)
    && new Set(value.items.map((item) => item.id)).size === value.items.length
    && (value.nextCursor === null || isNonEmptyString(value.nextCursor));
}

export function productionListPath(filters: ProductionListFilters, cursor?: string): string {
  const query = new URLSearchParams();
  query.set("limit", "50");
  if (filters.status !== undefined) query.set("status", filters.status);
  if (filters.from !== undefined && filters.from.length > 0) query.set("from", filters.from);
  if (filters.to !== undefined && filters.to.length > 0) query.set("to", filters.to);
  if (filters.recipeId !== undefined && filters.recipeId.length > 0) query.set("recipeId", filters.recipeId);
  if (filters.outputProductIdSnapshot !== undefined && filters.outputProductIdSnapshot.length > 0) query.set("outputProductIdSnapshot", filters.outputProductIdSnapshot);
  if (cursor !== undefined) query.set("cursor", cursor);
  return `/productions?${query.toString()}`;
}

export async function requestProductionList(
  api: ProductionListApi,
  filters: ProductionListFilters,
  cursor?: string,
): Promise<ProductionListPage> {
  const payload = await api.request<unknown>(productionListPath(filters, cursor), { expectedStatus: 200 });
  if (!isProductionListPage(payload)) throw new ApiError("server");
  return payload;
}

function isActiveRecipe(value: unknown): value is ActiveRecipe {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return (
    isString(value.id) &&
    isString(value.rootRecipeId) &&
    isString(value.name) &&
    isString(value.outputProductId) &&
    isDecimalString(value.yieldQuantity) &&
    isString(value.yieldUnitId) &&
    value.status === "ACTIVE" &&
    Number.isInteger(value.revision) &&
    isNullableString(value.note) &&
    value.items.every((item) => isRecord(item) && isString(item.id) && isString(item.productId) && isString(item.unitId) && isDecimalString(item.quantity) && Number.isInteger(item.sortOrder))
  );
}

export function isActiveRecipeList(value: unknown): value is ActiveRecipe[] {
  return Array.isArray(value) && value.every(isActiveRecipe);
}

export function isPostedProductionResult(value: unknown, productionId: string): value is PostedProductionResult {
  return isPlainRecord(value)
    && hasExactlyKeys(value, POSTED_PRODUCTION_RESULT_KEYS)
    && isString(value.id)
    && value.id.trim().length > 0
    && value.id === productionId
    && value.status === "POSTED"
    && isIsoTimestamp(value.postedAt)
    && isDecimalString(value.actualQuantity);
}

// The post endpoint intentionally returns only these authoritative lifecycle
// fields. Callers must not manufacture changed consumption or costing details.
export function mergePostedProductionResult(production: Production, posted: PostedProductionResult): Production {
  return { ...production, actualQuantity: posted.actualQuantity, postedAt: posted.postedAt, status: posted.status };
}

/**
 * Posting has irreversible inventory and costing effects. Its lifecycle-only
 * response is authoritative only when it exactly matches the API contract;
 * do not add a read-after-write request that could make a committed posting
 * look retryable.
 */
export async function requestProductionPosting(
  api: ProductionPostingApi,
  production: Production,
  actualQuantity: string,
): Promise<Production> {
  const payload = await api.request<unknown>(`/productions/${encodeURIComponent(production.id)}/post`, {
    method: "POST",
    body: { actualQuantity },
    expectedStatus: 200,
  });
  if (!isPostedProductionResult(payload, production.id)) throw new ApiError("server");
  return mergePostedProductionResult(production, payload);
}

/**
 * A post may have crossed the network boundary even when its result cannot be
 * trusted. The user must reconcile with an authoritative reload before any
 * further lifecycle action; never automatically post again.
 */
export function isAmbiguousProductionPostingError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.kind === "conflict" || error.kind === "server" || error.kind === "network";
}

function isPositiveDecimal(value: string, pattern: RegExp): boolean {
  return pattern.test(value) && value.replace(".", "").split("").some((digit) => digit !== "0");
}

function required(value: string, label: string, errors: ProductionFieldErrors, field: string): void {
  if (value.trim().length === 0) errors[field] = `${label}を入力してください。`;
}

function productionFormErrors(values: ProductionFormValues): ProductionFieldErrors {
  const errors: ProductionFieldErrors = {};
  required(values.productionDate, "生産日", errors, "productionDate");
  if (values.productionDate.trim().length > 0 && Number.isNaN(Date.parse(values.productionDate))) {
    errors.productionDate = "生産日は有効な日付で入力してください。";
  }
  const plannedQuantity = values.plannedQuantity.trim();
  if (!isPositiveDecimal(plannedQuantity, DECIMAL_24_9)) {
    errors.plannedQuantity = "予定生産量は9桁以下の小数を含む正の10進数で入力してください。";
  }
  return errors;
}

export function validateProductionCreate(values: ProductionCreateValues): ProductionFieldErrors {
  const errors = productionFormErrors(values);
  required(values.recipeId, "有効なレシピ", errors, "recipeId");
  return errors;
}

export function validateProductionUpdate(values: ProductionFormValues): ProductionFieldErrors {
  return productionFormErrors(values);
}

export function validateActualQuantity(value: string): string | undefined {
  return isPositiveDecimal(value.trim(), POST_DECIMAL) ? undefined : "実績生産量は正の10進数で入力してください。";
}

function optionalNote(value: string): string | null {
  const note = value.trim();
  return note.length === 0 ? null : note;
}

// Decimal fields remain user-entered strings; this intentionally contains no
// client-side inventory, cost, yield, or conversion calculation.
export function productionCreatePayload(values: ProductionCreateValues) {
  return {
    recipeId: values.recipeId,
    productionDate: values.productionDate.trim(),
    plannedQuantity: values.plannedQuantity.trim(),
    note: optionalNote(values.note),
  };
}

// The E1 PATCH allowlist is deliberately represented by this exact payload.
export function productionUpdatePayload(values: ProductionFormValues) {
  return {
    productionDate: values.productionDate.trim(),
    plannedQuantity: values.plannedQuantity.trim(),
    note: optionalNote(values.note),
  };
}

export function productionFormFromProduction(production: Production): ProductionFormValues {
  return {
    productionDate: production.productionDate.slice(0, 10),
    plannedQuantity: production.plannedQuantity,
    note: production.note ?? "",
  };
}

export function initialProductionCreateValues(): ProductionCreateValues {
  return {
    recipeId: "",
    productionDate: new Date().toISOString().slice(0, 10),
    plannedQuantity: "",
    note: "",
  };
}

export function productionStatusLabel(status: ProductionStatus): string {
  switch (status) {
    case "DRAFT": return "下書き";
    case "CONFIRMED": return "確認済み";
    case "POSTED": return "計上済み";
    case "CANCELLED": return "取消済み";
  }
}

export function formatProductionTimestamp(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
