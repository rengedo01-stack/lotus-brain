const timestampSchema = { type: "string" as const, format: "date-time" };

export const replenishmentPolicySchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "productId", "reorderPointQuantity", "version", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    productId: { type: "string" as const, minLength: 1 },
    reorderPointQuantity: { type: "string" as const, pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" },
    version: { type: "integer" as const, minimum: 1 },
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  },
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

const replenishmentPolicyProductSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted", "inventoryUnit"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
    inventoryUnit: inventoryUnitSchema,
  },
};

export const replenishmentPolicyContextSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["product", "policy"],
  properties: {
    product: replenishmentPolicyProductSchema,
    policy: { oneOf: [replenishmentPolicySchema, { type: "null" as const }] },
  },
};
