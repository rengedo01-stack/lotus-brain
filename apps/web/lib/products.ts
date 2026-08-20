export type Product = {
  baseUnitId: string;
  code: string;
  createdAt: string;
  description: string | null;
  id: string;
  inventoryUnitId: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  updatedAt: string;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isProduct(value: unknown): value is Product {
  if (typeof value !== "object" || value === null) return false;
  const product = value as Record<string, unknown>;
  return (
    isString(product.id) &&
    isString(product.code) &&
    isString(product.name) &&
    (product.description === null || isString(product.description)) &&
    isString(product.baseUnitId) &&
    isString(product.inventoryUnitId) &&
    (product.status === "ACTIVE" || product.status === "INACTIVE") &&
    isString(product.createdAt) &&
    isString(product.updatedAt)
  );
}

export function isProductList(value: unknown): value is Product[] {
  return Array.isArray(value) && value.every(isProduct);
}

export function formatOperationalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function productStatusLabel(status: Product["status"]): string {
  return status === "ACTIVE" ? "有効" : "無効";
}
