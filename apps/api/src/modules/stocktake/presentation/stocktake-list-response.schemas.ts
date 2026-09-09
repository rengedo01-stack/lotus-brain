const nullableDateTimeSchema = {
  oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }],
};

export const stocktakeListItemResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "startedAt", "completedAt", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    startedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const stocktakeListPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: stocktakeListItemResponseSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};
