/**
 * Posting returns only lifecycle authority. Inventory, consumption and costing
 * effects remain server-owned and intentionally never become response data.
 */
export const postedProductionResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "postedAt", "actualQuantity"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["POSTED"] },
    postedAt: { type: "string" as const, format: "date-time" },
    actualQuantity: { type: "string" as const, pattern: "^(?:0|[1-9]\\d*)(?:\\.\\d+)?$" },
  },
};

const nullableDateTimeSchema = {
  oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }],
};

const productionListRecipeSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "rootRecipeId", "revision"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    rootRecipeId: { type: "string" as const, minLength: 1 },
    revision: { type: "integer" as const, minimum: 1 },
  },
};

export const productionListItemResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "productionDate", "outputProductIdSnapshot", "recipe", "postedAt", "cancelledAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    productionDate: { type: "string" as const, format: "date-time" },
    outputProductIdSnapshot: { type: "string" as const, minLength: 1 },
    recipe: productionListRecipeSchema,
    postedAt: nullableDateTimeSchema,
    cancelledAt: nullableDateTimeSchema,
  },
};

export const productionListPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: productionListItemResponseSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};
