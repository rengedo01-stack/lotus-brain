const decimalSchema = { type: "string" as const, pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" };
const positiveDecimalSchema = { type: "string" as const, pattern: "^[1-9][0-9]{0,14}(?:\\.[0-9]{1,9})?$" };
const timestampSchema = { type: "string" as const, format: "date-time" };

const productSchema = {
  type: "object" as const, additionalProperties: false, required: ["id", "code", "name"],
  properties: { id: { type: "string" as const, minLength: 1 }, code: { type: "string" as const, minLength: 1 }, name: { type: "string" as const, minLength: 1 } },
};
const inventoryUnitSchema = {
  type: "object" as const, additionalProperties: false, required: ["code", "name", "symbol"],
  properties: { code: { type: "string" as const, minLength: 1 }, name: { type: "string" as const, minLength: 1 }, symbol: { type: "string" as const, minLength: 1 } },
};
const supplierSchema = {
  type: "object" as const, additionalProperties: false, required: ["id", "code", "name"],
  properties: { id: { type: "string" as const, minLength: 1 }, code: { type: "string" as const, minLength: 1 }, name: { type: "string" as const, minLength: 1 } },
};
const preferredSupplierSchema = {
  type: "object" as const, additionalProperties: false, required: ["relationshipId", "relationshipVersion", "preferenceVersion", "supplier"],
  properties: { relationshipId: { type: "string" as const, minLength: 1 }, relationshipVersion: { type: "integer" as const, minimum: 1 }, preferenceVersion: { type: "integer" as const, minimum: 1 }, supplier: supplierSchema },
};
const orderingTermsSchema = {
  type: "object" as const, additionalProperties: false, required: ["minimumOrderQuantity", "orderMultipleQuantity", "version"],
  properties: { minimumOrderQuantity: { oneOf: [positiveDecimalSchema, { type: "null" as const }] }, orderMultipleQuantity: { oneOf: [positiveDecimalSchema, { type: "null" as const }] }, version: { type: "integer" as const, minimum: 1 } },
};
const preferredPackageSchema = {
  type: "object" as const, additionalProperties: false, required: ["id", "code", "name", "inventoryQuantityPerPackage", "version", "preferenceVersion"],
  properties: { id: { type: "string" as const, minLength: 1 }, code: { type: "string" as const, minLength: 1 }, name: { type: "string" as const, minLength: 1 }, inventoryQuantityPerPackage: positiveDecimalSchema, version: { type: "integer" as const, minimum: 1 }, preferenceVersion: { type: "integer" as const, minimum: 1 } },
};
const resultSchema = {
  type: "object" as const, additionalProperties: false, required: ["rawTargetGap", "feasibleQuantity", "overOrderQuantity", "packageCount"],
  properties: { rawTargetGap: positiveDecimalSchema, feasibleQuantity: positiveDecimalSchema, overOrderQuantity: decimalSchema, packageCount: { oneOf: [{ type: "string" as const, pattern: "^[1-9][0-9]*$" }, { type: "null" as const }] } },
};
const snapshotSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["currentQuantity", "inventoryVersion", "reorderPointQuantity", "targetStockQuantity", "replenishmentPolicyVersion", "draftPurchaseQuantity", "confirmedPurchaseQuantity", "preferredSupplier", "orderingTerms", "preferredPackage", "result"],
  properties: {
    currentQuantity: decimalSchema,
    inventoryVersion: { type: "integer" as const, minimum: 1 },
    reorderPointQuantity: decimalSchema,
    targetStockQuantity: decimalSchema,
    replenishmentPolicyVersion: { type: "integer" as const, minimum: 1 },
    draftPurchaseQuantity: decimalSchema,
    confirmedPurchaseQuantity: decimalSchema,
    preferredSupplier: preferredSupplierSchema,
    orderingTerms: { oneOf: [orderingTermsSchema, { type: "null" as const }] },
    preferredPackage: { oneOf: [preferredPackageSchema, { type: "null" as const }] },
    result: resultSchema,
  },
};

export const replenishmentRecommendationSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "disposition", "version", "calculationPolicyVersion", "createdAt", "supersededAt", "dismissedAt", "freshness", "product", "inventoryUnit", "snapshot"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    disposition: { type: "string" as const, enum: ["ACTIVE", "SUPERSEDED", "DISMISSED"] },
    version: { type: "integer" as const, minimum: 1 },
    calculationPolicyVersion: { type: "integer" as const, minimum: 1 },
    createdAt: timestampSchema,
    supersededAt: { oneOf: [timestampSchema, { type: "null" as const }] },
    dismissedAt: { oneOf: [timestampSchema, { type: "null" as const }] },
    freshness: { type: "string" as const, enum: ["CURRENT", "STALE", "INVALID"] },
    product: productSchema,
    inventoryUnit: inventoryUnitSchema,
    snapshot: snapshotSchema,
  },
};

export const replenishmentRecommendationResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["recommendation"],
  properties: { recommendation: { oneOf: [replenishmentRecommendationSchema, { type: "null" as const }] } },
};

export const recalculatedReplenishmentRecommendationResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["recommendation"],
  properties: { recommendation: replenishmentRecommendationSchema },
};
