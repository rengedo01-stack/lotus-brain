/**
 * The post endpoint returns only lifecycle authority. Business effects such as
 * inventory and price history remain server-owned and are intentionally not
 * represented in this response.
 */
export const postedPurchaseResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "postedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["POSTED"] },
    postedAt: { type: "string" as const, format: "date-time" },
  },
};

const quantityDecimalSchema = {
  type: "string" as const,
  pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
  description: "A positive quantity serialized in the Product inventory unit.",
};

const moneyDecimalSchema = {
  type: "string" as const,
  pattern: "^(?:0|[1-9][0-9]{0,13})(?:\\.[0-9]{1,6})?$",
};

const taxRateSchema = {
  type: "string" as const,
  pattern: "^(?:0(?:\\.[0-9]{1,4})?|1(?:\\.0{1,4})?)$",
};

const purchaseDraftSupplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

const purchaseDraftItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "lineNumber", "productId", "unitId", "quantity", "unitPrice", "taxRate", "lineAmount"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    lineNumber: { type: "integer" as const, minimum: 1 },
    productId: { type: "string" as const, minLength: 1 },
    unitId: { type: "string" as const, minLength: 1 },
    quantity: quantityDecimalSchema,
    unitPrice: moneyDecimalSchema,
    taxRate: taxRateSchema,
    lineAmount: moneyDecimalSchema,
  },
};

/**
 * The manual purchase draft contract. Monetary and quantity values remain
 * server-calculated/serialized Decimal strings; clients must not infer fields
 * beyond this exact response shape.
 */
export const purchaseDraftResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "supplier", "status", "purchaseDate", "documentNumber", "note", "subtotal", "tax", "total", "postedAt", "createdAt", "updatedAt", "items"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    supplier: purchaseDraftSupplierSchema,
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    purchaseDate: { type: "string" as const, format: "date-time" },
    documentNumber: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    note: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    subtotal: moneyDecimalSchema,
    tax: moneyDecimalSchema,
    total: moneyDecimalSchema,
    postedAt: { oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }] },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
    items: { type: "array" as const, items: purchaseDraftItemSchema },
  },
};

const nullableDateTimeSchema = {
  oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }],
};

const purchaseListSupplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["code", "name"],
  properties: {
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

export const purchaseListItemResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "purchaseDate", "documentNumber", "postedAt", "cancelledAt", "supplier"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    purchaseDate: { type: "string" as const, format: "date-time" },
    documentNumber: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    postedAt: nullableDateTimeSchema,
    cancelledAt: nullableDateTimeSchema,
    supplier: purchaseListSupplierSchema,
  },
};

export const purchaseListPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: purchaseListItemResponseSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};
