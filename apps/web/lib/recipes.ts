export const RECIPE_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

export type RecipeItem = {
  id: string;
  productId: string;
  quantity: string;
  sortOrder: number;
  unitId: string;
};

export type Recipe = {
  createdAt: string;
  id: string;
  items: RecipeItem[];
  name: string;
  note: string | null;
  outputProductId: string;
  revision: number;
  rootRecipeId: string;
  status: RecipeStatus;
  updatedAt: string;
  yieldQuantity: string;
  yieldUnitId: string;
};

export type RecipeItemFields = { clientKey: string; productId: string; quantity: string; unitId: string };
export type RecipeFormValues = { items: RecipeItemFields[]; name: string; note: string; outputProductId: string; yieldQuantity: string; yieldUnitId: string };
export type RecipeFieldErrors = Record<string, string>;

const DECIMAL_24_9 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isDecimalString(value: unknown): value is string {
  return isString(value) && DECIMAL_24_9.test(value);
}

function isRecipeStatus(value: unknown): value is RecipeStatus {
  return RECIPE_STATUSES.includes(value as RecipeStatus);
}

function isRecipeItem(value: unknown): value is RecipeItem {
  return isRecord(value)
    && isString(value.id)
    && isString(value.productId)
    && isString(value.unitId)
    && isDecimalString(value.quantity)
    && Number.isInteger(value.sortOrder);
}

export function isRecipe(value: unknown): value is Recipe {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return isString(value.id)
    && isString(value.rootRecipeId)
    && isString(value.name)
    && isString(value.outputProductId)
    && isDecimalString(value.yieldQuantity)
    && isString(value.yieldUnitId)
    && isRecipeStatus(value.status)
    && Number.isInteger(value.revision)
    && isNullableString(value.note)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && value.items.every(isRecipeItem);
}

export function isRecipeList(value: unknown): value is Recipe[] {
  return Array.isArray(value) && value.every(isRecipe);
}

export function initialRecipeFormValues(): RecipeFormValues {
  return { items: [{ clientKey: "item-1", productId: "", quantity: "", unitId: "" }], name: "", note: "", outputProductId: "", yieldQuantity: "", yieldUnitId: "" };
}

export function recipeFormFromRecipe(recipe: Recipe): RecipeFormValues {
  return {
    name: recipe.name,
    outputProductId: recipe.outputProductId,
    yieldQuantity: recipe.yieldQuantity,
    yieldUnitId: recipe.yieldUnitId,
    note: recipe.note ?? "",
    items: [...recipe.items].sort((left, right) => left.sortOrder - right.sortOrder).map((item) => ({ clientKey: item.id, productId: item.productId, quantity: item.quantity, unitId: item.unitId })),
  };
}

function addRequired(value: string, label: string, errors: RecipeFieldErrors, field: string): void {
  if (value.trim().length === 0) errors[field] = `${label}を入力してください。`;
}

function isPositiveDecimal(value: string): boolean {
  return DECIMAL_24_9.test(value) && value.replace(".", "").split("").some((digit) => digit !== "0");
}

export function validateRecipeForm(values: RecipeFormValues): RecipeFieldErrors {
  const errors: RecipeFieldErrors = {};
  addRequired(values.name, "レシピ名", errors, "name");
  addRequired(values.outputProductId, "出力商品", errors, "outputProductId");
  addRequired(values.yieldUnitId, "歩留まり単位", errors, "yieldUnitId");
  if (!isPositiveDecimal(values.yieldQuantity.trim())) errors.yieldQuantity = "歩留まりはDecimal(24,9)に収まる正の10進数で入力してください。";
  if (values.items.length === 0) errors.items = "BOMを1行以上追加してください。";
  const products = new Set<string>();
  values.items.forEach((item, index) => {
    const prefix = `items.${index}`;
    addRequired(item.productId, "商品", errors, `${prefix}.productId`);
    addRequired(item.unitId, "単位", errors, `${prefix}.unitId`);
    if (!isPositiveDecimal(item.quantity.trim())) errors[`${prefix}.quantity`] = "数量はDecimal(24,9)に収まる正の10進数で入力してください。";
    if (item.productId.length > 0 && products.has(item.productId)) errors[`${prefix}.productId`] = "同一商品はBOMに1行だけ指定できます。";
    products.add(item.productId);
  });
  return errors;
}

// Decimal values stay strings and this is the complete Recipe create/update contract.
export function recipeDraftPayload(values: RecipeFormValues) {
  return {
    name: values.name.trim(),
    outputProductId: values.outputProductId,
    yieldQuantity: values.yieldQuantity.trim(),
    yieldUnitId: values.yieldUnitId,
    note: values.note.trim() || null,
    items: values.items.map((item) => ({ productId: item.productId, unitId: item.unitId, quantity: item.quantity.trim() })),
  };
}

export function recipeStatusLabel(status: RecipeStatus): string {
  if (status === "DRAFT") return "下書き";
  if (status === "ACTIVE") return "有効";
  return "アーカイブ済み";
}
