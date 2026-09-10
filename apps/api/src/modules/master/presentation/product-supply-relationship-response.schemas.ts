const relationshipReferenceSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted"],
  properties: {
    id: { type: "string" as const },
    code: { type: "string" as const },
    name: { type: "string" as const },
    status: { enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
  },
};

export const productSupplyRelationshipSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "productId", "supplierId", "status", "version", "createdAt", "updatedAt", "product", "supplier"],
  properties: {
    id: { type: "string" as const },
    productId: { type: "string" as const },
    supplierId: { type: "string" as const },
    status: { enum: ["ACTIVE", "DISABLED"] },
    version: { type: "integer" as const, minimum: 1 },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
    product: relationshipReferenceSchema,
    supplier: relationshipReferenceSchema,
  },
};

export const productSupplyRelationshipListSchema = {
  type: "array" as const,
  items: productSupplyRelationshipSchema,
};
