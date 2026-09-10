const timestampSchema = { type: "string" as const, format: "date-time" };
const positiveQuantitySchema = { type: "string" as const, pattern: "^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\\.[0-9]{1,9})?$" };

export const productSupplierPackageSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "relationshipId", "code", "name", "inventoryQuantityPerPackage", "isOrderable", "status", "version", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    relationshipId: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    inventoryQuantityPerPackage: positiveQuantitySchema,
    isOrderable: { type: "boolean" as const },
    status: { enum: ["ACTIVE", "DISABLED"] },
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

const productSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted", "inventoryUnit"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    status: { enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
    inventoryUnit: inventoryUnitSchema,
  },
};

const supplierSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "code", "name", "status", "isDeleted"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    code: { type: "string" as const, minLength: 1 },
    name: { type: "string" as const, minLength: 1 },
    status: { enum: ["ACTIVE", "INACTIVE"] },
    isDeleted: { type: "boolean" as const },
  },
};

const relationshipSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "status", "version", "product", "supplier"],
  properties: {
    id: { type: "string" as const, minLength: 1 },
    status: { enum: ["ACTIVE", "DISABLED"] },
    version: { type: "integer" as const, minimum: 1 },
    product: productSchema,
    supplier: supplierSchema,
  },
};

export const productSupplierPackagesContextSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["relationship", "packages"],
  properties: { relationship: relationshipSchema, packages: { type: "array" as const, items: productSupplierPackageSchema } },
};

export const productSupplierPackageContextSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["relationship", "package"],
  properties: { relationship: relationshipSchema, package: productSupplierPackageSchema },
};
