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
