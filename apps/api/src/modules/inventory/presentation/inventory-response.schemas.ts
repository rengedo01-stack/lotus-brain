const decimalStringSchema = {
  type: "string" as const,
  pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
};

const decimal24_9StringSchema = {
  type: "string" as const,
  pattern: "^-?(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
};

const nonNegativeDecimal24_9StringSchema = {
  type: "string" as const,
  pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
};

const positiveDecimal24_9StringSchema = {
  type: "string" as const,
  pattern: "^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
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

const inventoryProductSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
  },
};

export const currentInventoryItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["product", "quantity", "inventoryUnit", "updatedAt"],
  properties: {
    product: inventoryProductSchema,
    quantity: decimalStringSchema,
    inventoryUnit: inventoryUnitSchema,
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const currentInventoryPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: currentInventoryItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};

const inventorySupplyProductSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

export const inventorySupplyContextItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "product",
    "inventoryUnit",
    "currentQuantity",
    "draftPurchaseQuantity",
    "confirmedPurchaseQuantity",
  ],
  properties: {
    product: inventorySupplyProductSchema,
    inventoryUnit: inventoryUnitSchema,
    currentQuantity: decimalStringSchema,
    draftPurchaseQuantity: decimalStringSchema,
    confirmedPurchaseQuantity: decimalStringSchema,
  },
};

export const inventorySupplyContextPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: inventorySupplyContextItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};

export const replenishmentCandidateItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "product",
    "inventoryUnit",
    "currentQuantity",
    "reorderPointQuantity",
    "draftPurchaseQuantity",
    "confirmedPurchaseQuantity",
  ],
  properties: {
    product: inventorySupplyProductSchema,
    inventoryUnit: inventoryUnitSchema,
    currentQuantity: decimalStringSchema,
    reorderPointQuantity: decimalStringSchema,
    draftPurchaseQuantity: decimalStringSchema,
    confirmedPurchaseQuantity: decimalStringSchema,
  },
};

export const replenishmentCandidatePageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array" as const, items: replenishmentCandidateItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};

const replenishmentSupplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

const replenishmentPreferredSupplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["relationshipId", "supplier", "isEligible"],
  properties: {
    relationshipId: { type: "string" as const, minLength: 1 },
    supplier: replenishmentSupplierSchema,
    isEligible: { type: "boolean" as const },
  },
};

const replenishmentOrderingTermsSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["minimumOrderQuantity", "orderMultipleQuantity"],
  properties: {
    minimumOrderQuantity: { oneOf: [positiveDecimal24_9StringSchema, { type: "null" as const }] },
    orderMultipleQuantity: { oneOf: [positiveDecimal24_9StringSchema, { type: "null" as const }] },
  },
};

const replenishmentPreferredPackageSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "inventoryQuantityPerPackage", "isEligible"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    inventoryQuantityPerPackage: positiveDecimal24_9StringSchema,
    isEligible: { type: "boolean" as const },
  },
};

const replenishmentQuantityResultSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status", "rawTargetGap", "feasibleQuantity", "overOrderQuantity", "packageCount"],
  properties: {
    status: {
      type: "string" as const,
      enum: [
        "READY",
        "TARGET_NOT_CONFIGURED",
        "NO_POSITIVE_NEED",
        "INVENTORY_RECONCILIATION_REQUIRED",
        "NO_PREFERRED_SUPPLIER",
        "PREFERRED_SUPPLIER_INELIGIBLE",
        "PREFERRED_PACKAGE_INELIGIBLE",
        "CONSTRAINT_UNREPRESENTABLE",
        "NOT_A_REPLENISHMENT_CANDIDATE",
      ],
    },
    rawTargetGap: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    feasibleQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    overOrderQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    packageCount: { oneOf: [{ type: "string" as const, pattern: "^[1-9][0-9]*$" }, { type: "null" as const }] },
  },
};

/** A read-only explanation of a single product's current quantity constraints. */
export const replenishmentQuantityPreviewResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "product",
    "inventoryUnit",
    "currentQuantity",
    "reorderPointQuantity",
    "targetStockQuantity",
    "draftPurchaseQuantity",
    "confirmedPurchaseQuantity",
    "preferredSupplier",
    "orderingTerms",
    "preferredPackage",
    "result",
  ],
  properties: {
    product: inventorySupplyProductSchema,
    inventoryUnit: inventoryUnitSchema,
    currentQuantity: { oneOf: [decimal24_9StringSchema, { type: "null" as const }] },
    reorderPointQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    targetStockQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    draftPurchaseQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    confirmedPurchaseQuantity: { oneOf: [nonNegativeDecimal24_9StringSchema, { type: "null" as const }] },
    preferredSupplier: { oneOf: [replenishmentPreferredSupplierSchema, { type: "null" as const }] },
    orderingTerms: { oneOf: [replenishmentOrderingTermsSchema, { type: "null" as const }] },
    preferredPackage: { oneOf: [replenishmentPreferredPackageSchema, { type: "null" as const }] },
    result: replenishmentQuantityResultSchema,
  },
};

export const inventoryHistoryItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "type", "quantityDelta", "quantityAfter", "occurredAt", "inventoryUnit"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    type: {
      type: "string" as const,
      enum: ["RECEIPT", "CONSUMPTION", "PRODUCTION_RECEIPT", "STOCKTAKE_ADJUSTMENT", "MANUAL_ADJUSTMENT"],
    },
    quantityDelta: decimalStringSchema,
    quantityAfter: decimalStringSchema,
    occurredAt: { type: "string" as const, format: "date-time" },
    inventoryUnit: inventoryUnitSchema,
  },
};

export const inventoryHistoryPageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["currentInventory", "items", "nextCursor"],
  properties: {
    currentInventory: currentInventoryItemSchema,
    items: { type: "array" as const, items: inventoryHistoryItemSchema },
    nextCursor: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
  },
};
