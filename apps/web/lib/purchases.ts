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

function isString(value: unknown): value is string {
  return typeof value === "string";
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
