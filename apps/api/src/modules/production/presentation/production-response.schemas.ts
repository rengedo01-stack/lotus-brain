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
