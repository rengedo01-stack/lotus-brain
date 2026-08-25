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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProductionStatus(value: unknown): value is ProductionStatus {
  return PRODUCTION_STATUSES.includes(value as ProductionStatus);
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

export function isPostedProductionResult(value: unknown, productionId: string): value is { actualQuantity: string; id: string; postedAt: string; status: "POSTED" } {
  return isRecord(value) && value.id === productionId && value.status === "POSTED" && isString(value.postedAt) && isDecimalString(value.actualQuantity);
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
