/**
 * Posting returns lifecycle authority only. Inventory adjustments and history
 * rows are committed server-side and are deliberately not exposed here.
 */
export const postedStocktakeResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "completedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["POSTED"] },
    completedAt: { type: "string" as const, format: "date-time" },
  },
};
