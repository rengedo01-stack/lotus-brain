export const STOCKTAKE_STATUSES = ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] as const;

export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

export type StocktakeItem = {
  countedQuantity: string | null;
  differenceQuantity: string | null;
  id: string;
  inventoryUnitId: string;
  note: string | null;
  productId: string;
  systemQuantitySnapshot: string | null;
};

export type Stocktake = {
  completedAt: string | null;
  createdAt: string;
  id: string;
  items: StocktakeItem[];
  note: string | null;
  startedAt: string | null;
  status: StocktakeStatus;
  updatedAt: string;
};

export type StocktakeLineFormValues = {
  countedQuantity: string;
  note: string;
  productId: string;
  rowKey: string;
};

export type StocktakeFormValues = {
  items: StocktakeLineFormValues[];
  note: string;
};

export type StocktakeFieldErrors = Record<string, string>;

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isStocktakeStatus(value: unknown): value is StocktakeStatus {
  return STOCKTAKE_STATUSES.includes(value as StocktakeStatus);
}

export function isStocktakeItem(value: unknown): value is StocktakeItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isString(item.id) &&
    isString(item.productId) &&
    isString(item.inventoryUnitId) &&
    isNullableString(item.systemQuantitySnapshot) &&
    isNullableString(item.countedQuantity) &&
    isNullableString(item.differenceQuantity) &&
    isNullableString(item.note)
  );
}

export function isStocktake(value: unknown): value is Stocktake {
  if (typeof value !== "object" || value === null) return false;
  const stocktake = value as Record<string, unknown>;
  return (
    isString(stocktake.id) &&
    isStocktakeStatus(stocktake.status) &&
    isNullableString(stocktake.startedAt) &&
    isNullableString(stocktake.completedAt) &&
    isNullableString(stocktake.note) &&
    isString(stocktake.createdAt) &&
    isString(stocktake.updatedAt) &&
    Array.isArray(stocktake.items) &&
    stocktake.items.every(isStocktakeItem)
  );
}

export function emptyStocktakeLine(rowKey: string): StocktakeLineFormValues {
  return { countedQuantity: "", note: "", productId: "", rowKey };
}

export function emptyStocktakeForm(rowKey: string): StocktakeFormValues {
  return { items: [emptyStocktakeLine(rowKey)], note: "" };
}

// Server item IDs and server-calculated snapshots never become editable form data.
export function stocktakeFormFromStocktake(stocktake: Stocktake): StocktakeFormValues {
  return {
    note: stocktake.note ?? "",
    items: stocktake.items.map((item, index) => ({
      rowKey: `stocktake-line-${index + 1}`,
      productId: item.productId,
      countedQuantity: item.countedQuantity ?? "",
      note: item.note ?? "",
    })),
  };
}

function required(value: string, label: string, errors: StocktakeFieldErrors, field: string): void {
  if (value.trim().length === 0) errors[field] = `${label}を選択してください。`;
}

export function validateStocktakeForm(values: StocktakeFormValues): StocktakeFieldErrors {
  const errors: StocktakeFieldErrors = {};
  if (values.items.length === 0) errors.items = "棚卸明細を1件以上追加してください。";

  const selectedProductIds = new Set<string>();
  values.items.forEach((item) => {
    const prefix = `items.${item.rowKey}`;
    const productId = item.productId.trim();
    required(productId, "商品", errors, `${prefix}.productId`);
    if (productId.length > 0) {
      if (selectedProductIds.has(productId)) errors[`${prefix}.productId`] = "同じ商品は1回だけ追加してください。";
      selectedProductIds.add(productId);
    }

    const countedQuantity = item.countedQuantity.trim();
    // Draft counts may intentionally be blank. A submitted count must retain
    // the API's non-negative decimal-string contract without JS number math.
    if (countedQuantity.length > 0 && !DECIMAL_PATTERN.test(countedQuantity)) {
      errors[`${prefix}.countedQuantity`] = "実棚数量は0以上の10進数で入力してください。";
    }
  });

  return errors;
}

// Decimal values stay as user-entered strings. Difference and inventory math
// belongs exclusively to the Stocktake API and PostgreSQL transaction.
export function stocktakePayload(values: StocktakeFormValues) {
  const note = values.note.trim();
  return {
    note: note.length === 0 ? undefined : note,
    items: values.items.map((item) => {
      const countedQuantity = item.countedQuantity.trim();
      const itemNote = item.note.trim();
      return {
        productId: item.productId,
        countedQuantity: countedQuantity.length === 0 ? undefined : countedQuantity,
        note: itemNote.length === 0 ? undefined : itemNote,
      };
    }),
  };
}

export function stocktakeStatusLabel(status: StocktakeStatus): string {
  switch (status) {
    case "DRAFT": return "下書き";
    case "CONFIRMED": return "確認済み";
    case "POSTED": return "計上済み";
    case "CANCELLED": return "取消済み";
  }
}

export function formatStocktakeTimestamp(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
