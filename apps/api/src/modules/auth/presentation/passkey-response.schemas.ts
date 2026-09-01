const passkeyTimestampSchema = { type: "string" as const, format: "date-time" as const };

export const passkeyViewResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "id",
    "displayName",
    "transports",
    "deviceType",
    "backedUp",
    "createdAt",
    "updatedAt",
    "lastUsedAt",
    "revokedAt",
  ],
  properties: {
    id: { type: "string" as const },
    displayName: { type: "string" as const, nullable: true },
    transports: {
      type: "array" as const,
      items: { type: "string" as const, enum: ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"] },
    },
    deviceType: { type: "string" as const, enum: ["singleDevice", "multiDevice"], nullable: true },
    backedUp: { type: "boolean" as const, nullable: true },
    createdAt: passkeyTimestampSchema,
    updatedAt: passkeyTimestampSchema,
    lastUsedAt: { ...passkeyTimestampSchema, nullable: true },
    revokedAt: { ...passkeyTimestampSchema, nullable: true },
  },
};

export const passkeyListResponseSchema = {
  type: "array" as const,
  items: passkeyViewResponseSchema,
};

export const passkeyMutationResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["passkey"],
  properties: { passkey: passkeyViewResponseSchema },
};

export const passkeyMfaStatusResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["enabled", "activePasskeyCount", "recoveryEmailVerified"],
  properties: {
    enabled: { type: "boolean" as const },
    activePasskeyCount: { type: "integer" as const, minimum: 0 },
    recoveryEmailVerified: { type: "boolean" as const },
  },
};
