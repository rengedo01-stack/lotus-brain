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
