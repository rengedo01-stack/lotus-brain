const passkeyTimestampSchema = { type: "string" as const, format: "date-time" as const };
const base64UrlSchema = { type: "string" as const, minLength: 1, pattern: "^[A-Za-z0-9_-]+$" };

const credentialDescriptorSchema = {
  type: "object" as const,
  // Credential-descriptor extensions are standard-controlled. Document the
  // values Lotus BRAIN requires without excluding future WebAuthn fields.
  additionalProperties: true,
  required: ["id", "type"],
  properties: {
    id: base64UrlSchema,
    type: { type: "string" as const, enum: ["public-key"] },
    transports: { type: "array" as const, items: { type: "string" as const, minLength: 1 } },
  },
};

const webAuthnExtensionsSchema = {
  type: "object" as const,
  // WebAuthn extensions evolve independently of Lotus BRAIN. Keep their
  // forward-compatible keys instead of presenting a closed JSON object.
  additionalProperties: true,
  properties: {
    appid: { type: "string" as const, minLength: 1 },
    credProps: { type: "boolean" as const },
    hmacCreateSecret: { type: "boolean" as const },
    minPinLength: { type: "boolean" as const },
  },
};

const authenticatorSelectionSchema = {
  type: "object" as const,
  additionalProperties: true,
  properties: {
    authenticatorAttachment: { type: "string" as const, enum: ["cross-platform", "platform"] },
    requireResidentKey: { type: "boolean" as const },
    residentKey: { type: "string" as const, enum: ["discouraged", "preferred", "required"] },
    userVerification: { type: "string" as const, enum: ["discouraged", "preferred", "required"] },
  },
};

/**
 * The server delegates option generation to SimpleWebAuthn. Security-critical
 * fields are guaranteed; additional standard fields remain explicitly open
 * for forward-compatible browser/library evolution.
 */
export const passkeyRegistrationOptionsResponseSchema = {
  type: "object" as const,
  additionalProperties: true,
  required: ["challenge", "rp", "user", "pubKeyCredParams"],
  properties: {
    challenge: base64UrlSchema,
    rp: {
      type: "object" as const,
      additionalProperties: true,
      required: ["id", "name"],
      properties: {
        id: { type: "string" as const, minLength: 1 },
        name: { type: "string" as const, minLength: 1 },
      },
    },
    user: {
      type: "object" as const,
      additionalProperties: true,
      required: ["id", "name", "displayName"],
      properties: {
        id: base64UrlSchema,
        name: { type: "string" as const, minLength: 1 },
        displayName: { type: "string" as const },
      },
    },
    pubKeyCredParams: {
      type: "array" as const,
      minItems: 1,
      items: {
        type: "object" as const,
        additionalProperties: true,
        required: ["alg", "type"],
        properties: {
          alg: { type: "integer" as const },
          type: { type: "string" as const, enum: ["public-key"] },
        },
      },
    },
    timeout: { type: "integer" as const, minimum: 0, maximum: 4_294_967_295 },
    excludeCredentials: { type: "array" as const, items: credentialDescriptorSchema },
    authenticatorSelection: authenticatorSelectionSchema,
    hints: { type: "array" as const, items: { type: "string" as const, minLength: 1 } },
    attestation: { type: "string" as const, enum: ["direct", "enterprise", "indirect", "none"] },
    attestationFormats: { type: "array" as const, items: { type: "string" as const, minLength: 1 } },
    extensions: webAuthnExtensionsSchema,
  },
};

export const passkeyAuthenticationOptionsResponseSchema = {
  type: "object" as const,
  additionalProperties: true,
  required: ["challenge", "rpId", "allowCredentials"],
  properties: {
    challenge: base64UrlSchema,
    rpId: { type: "string" as const, minLength: 1 },
    allowCredentials: { type: "array" as const, minItems: 1, items: credentialDescriptorSchema },
    timeout: { type: "integer" as const, minimum: 0, maximum: 4_294_967_295 },
    userVerification: { type: "string" as const, enum: ["discouraged", "preferred", "required"] },
    hints: { type: "array" as const, items: { type: "string" as const, minLength: 1 } },
    extensions: webAuthnExtensionsSchema,
  },
};

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
