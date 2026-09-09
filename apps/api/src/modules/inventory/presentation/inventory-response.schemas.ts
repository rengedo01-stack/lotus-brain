const decimalStringSchema = {
  type: "string" as const,
  pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
};

const inventoryUnitSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["code", "name", "symbol"],
  properties: {
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    symbol: { type: "string" as const, minLength: 1 },
  },
};

const inventoryProductSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
  },
};

export const currentInventoryItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["product", "quantity", "inventoryUnit", "updatedAt"],
  properties: {
    product: inventoryProductSchema,
    quantity: decimalStringSchema,
    inventoryUnit: inventoryUnitSchema,
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const currentInventoryPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: currentInventoryItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};

const inventorySupplyProductSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

export const inventorySupplyContextItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "product",
    "inventoryUnit",
    "currentQuantity",
    "draftPurchaseQuantity",
    "confirmedPurchaseQuantity",
  ],
  properties: {
    product: inventorySupplyProductSchema,
    inventoryUnit: inventoryUnitSchema,
    currentQuantity: decimalStringSchema,
    draftPurchaseQuantity: decimalStringSchema,
    confirmedPurchaseQuantity: decimalStringSchema,
  },
};

export const inventorySupplyContextPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: inventorySupplyContextItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};

export const inventoryHistoryItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "type", "quantityDelta", "quantityAfter", "occurredAt", "inventoryUnit"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    type: {
      type: "string" as const,
      enum: ["RECEIPT", "CONSUMPTION", "PRODUCTION_RECEIPT", "STOCKTAKE_ADJUSTMENT", "MANUAL_ADJUSTMENT"],
    },
    quantityDelta: decimalStringSchema,
    quantityAfter: decimalStringSchema,
    occurredAt: { type: "string" as const, format: "date-time" },
    inventoryUnit: inventoryUnitSchema,
  },
};

export const inventoryHistoryPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["currentInventory", "items", "nextCursor"],
  properties: {
    currentInventory: currentInventoryItemSchema,
    items: { type: "array" as const, items: inventoryHistoryItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};
