export const MASTER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const UNIT_DIMENSIONS = ["COUNT", "MASS", "VOLUME"] as const;

export type MasterStatus = (typeof MASTER_STATUSES)[number];
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export type Unit = {
  code: string;
  createdAt: string;
  dimension: UnitDimension;
  id: string;
  name: string;
  status: MasterStatus;
  symbol: string;
  updatedAt: string;
};

export type Supplier = {
  code: string;
  createdAt: string;
  id: string;
  name: string;
  status: MasterStatus;
  updatedAt: string;
};

export type ProductUnitConversion = {
  createdAt: string;
  factorToBaseUnit: string;
  id: string;
  productId: string;
  status: MasterStatus;
  unitId: string;
  updatedAt: string;
};

export type FieldErrors = Record<string, string>;

type ProductCreateFields = {
  baseUnitId: string;
  code: string;
  description: string;
  inventoryUnitId: string;
  name: string;
  status: MasterStatus;
};

type ProductEditFields = Pick<ProductCreateFields, "description" | "name" | "status">;

type UnitCreateFields = {
  code: string;
  dimension: UnitDimension;
  name: string;
  status: MasterStatus;
  symbol: string;
};

type SupplierCreateFields = {
  code: string;
  name: string;
  status: MasterStatus;
};

type SupplierEditFields = Pick<SupplierCreateFields, "name" | "status">;

type ConversionCreateFields = {
  factorToBaseUnit: string;
  status: MasterStatus;
  unitId: string;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isMasterStatus(value: unknown): value is MasterStatus {
  return MASTER_STATUSES.includes(value as MasterStatus);
}

function isUnitDimension(value: unknown): value is UnitDimension {
  return UNIT_DIMENSIONS.includes(value as UnitDimension);
}

export function isUnit(value: unknown): value is Unit {
  if (typeof value !== "object" || value === null) return false;
  const unit = value as Record<string, unknown>;
  return (
    isString(unit.id) &&
    isString(unit.code) &&
    isString(unit.name) &&
    isString(unit.symbol) &&
    isUnitDimension(unit.dimension) &&
    isMasterStatus(unit.status) &&
    isString(unit.createdAt) &&
    isString(unit.updatedAt)
  );
}

export function isUnitList(value: unknown): value is Unit[] {
  return Array.isArray(value) && value.every(isUnit);
}

export function isSupplier(value: unknown): value is Supplier {
  if (typeof value !== "object" || value === null) return false;
  const supplier = value as Record<string, unknown>;
  return (
    isString(supplier.id) &&
    isString(supplier.code) &&
    isString(supplier.name) &&
    isMasterStatus(supplier.status) &&
    isString(supplier.createdAt) &&
    isString(supplier.updatedAt)
  );
}

export function isSupplierList(value: unknown): value is Supplier[] {
  return Array.isArray(value) && value.every(isSupplier);
}

export function isProductUnitConversion(value: unknown): value is ProductUnitConversion {
  if (typeof value !== "object" || value === null) return false;
  const conversion = value as Record<string, unknown>;
  return (
    isString(conversion.id) &&
    isString(conversion.productId) &&
    isString(conversion.unitId) &&
    isString(conversion.factorToBaseUnit) &&
    isMasterStatus(conversion.status) &&
    isString(conversion.createdAt) &&
    isString(conversion.updatedAt)
  );
}

export function isProductUnitConversionList(value: unknown): value is ProductUnitConversion[] {
  return Array.isArray(value) && value.every(isProductUnitConversion);
}

function required(value: string, label: string, errors: FieldErrors, field: string): void {
  if (value.trim().length === 0) errors[field] = `${label}を入力してください。`;
}

export function validateProductCreate(fields: ProductCreateFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.code, "商品コード", errors, "code");
  required(fields.name, "商品名", errors, "name");
  required(fields.baseUnitId, "基準単位", errors, "baseUnitId");
  required(fields.inventoryUnitId, "在庫単位", errors, "inventoryUnitId");
  return errors;
}

export function productCreatePayload(fields: ProductCreateFields) {
  return {
    code: fields.code.trim(),
    name: fields.name.trim(),
    description: fields.description.trim() || undefined,
    baseUnitId: fields.baseUnitId,
    inventoryUnitId: fields.inventoryUnitId,
    status: fields.status,
  };
}

export function validateProductEdit(fields: ProductEditFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.name, "商品名", errors, "name");
  return errors;
}

// Keep the API's immutable product fields out of every PATCH payload.
export function productUpdatePayload(fields: ProductEditFields) {
  return {
    name: fields.name.trim(),
    description: fields.description.trim() || null,
    status: fields.status,
  };
}

export function validateUnitCreate(fields: UnitCreateFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.code, "単位コード", errors, "code");
  required(fields.name, "単位名", errors, "name");
  required(fields.symbol, "記号", errors, "symbol");
  return errors;
}

export function unitCreatePayload(fields: UnitCreateFields) {
  return {
    code: fields.code.trim(),
    name: fields.name.trim(),
    symbol: fields.symbol.trim(),
    dimension: fields.dimension,
    status: fields.status,
  };
}

// Unit code, name, symbol, and dimension are immutable by the API contract.
export function unitStatusUpdatePayload(status: MasterStatus) {
  return { status };
}

export function validateSupplierCreate(fields: SupplierCreateFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.code, "仕入先コード", errors, "code");
  required(fields.name, "仕入先名", errors, "name");
  return errors;
}

export function supplierCreatePayload(fields: SupplierCreateFields) {
  return { code: fields.code.trim(), name: fields.name.trim(), status: fields.status };
}

export function validateSupplierEdit(fields: SupplierEditFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.name, "仕入先名", errors, "name");
  return errors;
}

export function supplierUpdatePayload(fields: SupplierEditFields) {
  return { name: fields.name.trim(), status: fields.status };
}

export function validateConversionCreate(fields: ConversionCreateFields): FieldErrors {
  const errors: FieldErrors = {};
  required(fields.unitId, "換算する単位", errors, "unitId");
  required(fields.factorToBaseUnit, "換算係数", errors, "factorToBaseUnit");
  return errors;
}

// Decimal input stays a string all the way to the API. Do not parse it as a JS number.
export function productUnitConversionCreatePayload(fields: ConversionCreateFields) {
  return {
    unitId: fields.unitId,
    factorToBaseUnit: fields.factorToBaseUnit.trim(),
    status: fields.status,
  };
}

export function masterStatusLabel(status: MasterStatus): string {
  return status === "ACTIVE" ? "有効" : "無効";
}

export function unitDimensionLabel(dimension: UnitDimension): string {
  switch (dimension) {
    case "COUNT": return "個数";
    case "MASS": return "質量";
    case "VOLUME": return "体積";
  }
}
