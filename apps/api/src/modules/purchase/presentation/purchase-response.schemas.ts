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

export const cancelledPurchaseResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "cancelledAt", "cancellationReason"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["CANCELLED"] },
    cancelledAt: { type: "string" as const, format: "date-time" },
    cancellationReason: { type: "string" as const, minLength: 1, maxLength: 10_000 },
  },
};

const quantityDecimalSchema = {
  type: "string" as const,
  pattern: "^(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
  description: "A positive quantity serialized in the Product inventory unit.",
};

// The generic quantity schema also serves contracts where zero is meaningful.
// Recommendation and package snapshots are constrained to strictly positive
// quantities at the database boundary, so their public contract says so too.
const positiveQuantityDecimalSchema = {
  type: "string" as const,
  pattern: "^(?!0(?:\\.0+)?$)(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$",
};

const moneyDecimalSchema = {
  type: "string" as const,
  pattern: "^(?:0|[1-9][0-9]{0,13})(?:\\.[0-9]{1,6})?$",
};

const taxRateSchema = {
  type: "string" as const,
  pattern: "^(?:0(?:\\.[0-9]{1,4})?|1(?:\\.0{1,4})?)$",
};

const purchaseDraftSupplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
  },
};

const purchaseDraftItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "lineNumber", "productId", "unitId", "quantity", "unitPrice", "taxRate", "lineAmount"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    lineNumber: { type: "integer" as const, minimum: 1 },
    productId: { type: "string" as const, minLength: 1 },
    unitId: { type: "string" as const, minLength: 1 },
    quantity: quantityDecimalSchema,
    unitPrice: moneyDecimalSchema,
    taxRate: taxRateSchema,
    lineAmount: moneyDecimalSchema,
  },
};

/**
 * The manual purchase draft contract. Monetary and quantity values remain
 * server-calculated/serialized Decimal strings; clients must not infer fields
 * beyond this exact response shape.
 */
export const purchaseDraftResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "supplier", "status", "purchaseDate", "documentNumber", "note", "subtotal", "tax", "total", "postedAt", "cancelledAt", "cancellationReason", "createdAt", "updatedAt", "items"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    supplier: purchaseDraftSupplierSchema,
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    purchaseDate: { type: "string" as const, format: "date-time" },
    documentNumber: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    note: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    subtotal: moneyDecimalSchema,
    tax: moneyDecimalSchema,
    total: moneyDecimalSchema,
    postedAt: { oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }] },
    cancelledAt: { oneOf: [{ type: "string" as const, format: "date-time" }, { type: "null" as const }] },
    cancellationReason: { oneOf: [{ type: "string" as const, minLength: 1, maxLength: 10_000 }, { type: "null" as const }] },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
    items: { type: "array" as const, items: purchaseDraftItemSchema },
  },
};

export const recommendationPurchaseDraftHandoffResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["purchase"],
  properties: { purchase: purchaseDraftResponseSchema },
};

const handoffPurchaseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "purchaseDate"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    purchaseDate: { type: "string" as const, format: "date-time" },
  },
};

const handoffPurchaseItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string" as const, minLength: 1 } },
};

const handoffPackageSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "quantity", "version"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    quantity: positiveQuantityDecimalSchema,
    version: { type: "integer" as const, minimum: 1 },
  },
};

const handoffCommercialTermsSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "version", "unitPrice", "currencyCode", "taxRate"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    version: { type: "integer" as const, minimum: 1 },
    unitPrice: moneyDecimalSchema,
    currencyCode: { type: "string" as const, enum: ["JPY"] },
    taxRate: taxRateSchema,
  },
};

const handoffSourceSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["relationshipId", "supplierId", "recommendedQuantity", "package", "commercialTerms"],
  properties: {
    relationshipId: { type: "string" as const, minLength: 1 },
    supplierId: { type: "string" as const, minLength: 1 },
    recommendedQuantity: positiveQuantityDecimalSchema,
    package: { oneOf: [handoffPackageSchema, { type: "null" as const }] },
    commercialTerms: handoffCommercialTermsSchema,
  },
};

export const recommendationPurchaseHandoffLineageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["handoff"],
  properties: {
    handoff: {
      oneOf: [
        {
          type: "object" as const,
          additionalProperties: false,
          required: ["sourceRecommendationId", "createdAt", "purchase", "purchaseItem", "source"],
          properties: {
            sourceRecommendationId: { type: "string" as const, minLength: 1 },
            createdAt: { type: "string" as const, format: "date-time" },
            purchase: handoffPurchaseSchema,
            purchaseItem: handoffPurchaseItemSchema,
            source: handoffSourceSchema,
          },
        },
        { type: "null" as const },
      ],
    },
  },
};

const purchaseHandoffLineageItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["sourceRecommendationId", "createdAt", "purchaseItemId", "lineNumber", "source"],
  properties: {
    sourceRecommendationId: { type: "string" as const, minLength: 1 },
    createdAt: { type: "string" as const, format: "date-time" },
    purchaseItemId: { type: "string" as const, minLength: 1 },
    lineNumber: { type: "integer" as const, minimum: 1 },
    source: handoffSourceSchema,
  },
};

export const purchaseHandoffLineageResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["handoffs"],
  properties: {
    handoffs: { type: "array" as const, items: purchaseHandoffLineageItemSchema },
  },
};

const purchaseReversalAuditItemSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["purchaseItemId", "productId", "inventoryUnitId", "quantity", "unitPrice", "currency"],
  properties: {
    purchaseItemId: { type: "string" as const, minLength: 1 },
    productId: { type: "string" as const, minLength: 1 },
    inventoryUnitId: { type: "string" as const, minLength: 1 },
    quantity: positiveQuantityDecimalSchema,
    unitPrice: moneyDecimalSchema,
    currency: { type: "string" as const, pattern: "^[A-Z]{3}$" },
  },
};

const purchaseReversalAuditInventoryEffectSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["productId", "inventoryId", "inventoryUnitId", "quantityDelta", "quantityAfter", "averageUnitCost"],
  properties: {
    productId: { type: "string" as const, minLength: 1 },
    inventoryId: { type: "string" as const, minLength: 1 },
    inventoryUnitId: { type: "string" as const, minLength: 1 },
    quantityDelta: { type: "string" as const, pattern: "^-(?!0(?:\\.0+)?$)(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" },
    quantityAfter: quantityDecimalSchema,
    averageUnitCost: { oneOf: [moneyDecimalSchema, { type: "null" as const }] },
  },
};

const purchaseReversalAuditPriceEffectSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["priceMasterId", "source", "previousCurrentPriceHistoryId", "previousVersion", "appliedUnitPrice", "appliedCurrency", "effectiveAt", "becomesCurrent", "priceHistoryId"],
  properties: {
    priceMasterId: { type: "string" as const, minLength: 1 },
    source: { type: "string" as const, enum: ["ORIGINAL_PURCHASE_CURRENT", "SUBSEQUENT_PRICE_HISTORY_CURRENT", "LEGACY_UNKNOWN_CURRENT"] },
    previousCurrentPriceHistoryId: { oneOf: [{ type: "string" as const, minLength: 1 }, { type: "null" as const }] },
    previousVersion: { type: "integer" as const, minimum: 1 },
    appliedUnitPrice: moneyDecimalSchema,
    appliedCurrency: { type: "string" as const, pattern: "^[A-Z]{3}$" },
    effectiveAt: { type: "string" as const, format: "date-time" },
    becomesCurrent: { type: "boolean" as const },
    priceHistoryId: { type: "string" as const, minLength: 1 },
  },
};

const purchaseReversalAuditSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "purchaseId", "actorUserId", "reason", "reversedAt", "items", "inventoryEffects", "priceEffects"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    purchaseId: { type: "string" as const, minLength: 1 },
    actorUserId: { type: "string" as const, minLength: 1 },
    reason: { type: "string" as const, minLength: 1, maxLength: 10_000 },
    reversedAt: { type: "string" as const, format: "date-time" },
    items: { type: "array" as const, items: purchaseReversalAuditItemSchema },
    inventoryEffects: { type: "array" as const, items: purchaseReversalAuditInventoryEffectSchema },
    priceEffects: { type: "array" as const, items: purchaseReversalAuditPriceEffectSchema },
  },
};

export const purchaseReversalAuditResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["reversal"],
  properties: {
    reversal: { oneOf: [purchaseReversalAuditSchema, { type: "null" as const }] },
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

const purchaseListCorrectionSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "reversedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    reversedAt: { type: "string" as const, format: "date-time" },
  },
};

export const purchaseListItemResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "purchaseDate", "documentNumber", "postedAt", "cancelledAt", "supplier", "correction"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { type: "string" as const, enum: ["DRAFT", "CONFIRMED", "POSTED", "CANCELLED"] },
    purchaseDate: { type: "string" as const, format: "date-time" },
    documentNumber: { oneOf: [{ type: "string" as const }, { type: "null" as const }] },
    postedAt: nullableDateTimeSchema,
    cancelledAt: nullableDateTimeSchema,
    supplier: purchaseListSupplierSchema,
    correction: { oneOf: [purchaseListCorrectionSchema, { type: "null" as const }] },
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
