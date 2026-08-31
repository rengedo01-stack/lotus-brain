export const authenticatedLoginUserResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["id", "email", "displayName", "status", "lastLoginAt", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" as const },
    email: { type: "string" as const },
    displayName: { type: "string" as const },
    // Login, activation, and SessionAuthGuard all require an active, non-deleted user.
    status: { type: "string" as const, enum: ["ACTIVE"] },
    lastLoginAt: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const authenticatedLoginResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["user", "csrfToken"],
  properties: {
    user: authenticatedLoginUserResponseSchema,
    csrfToken: { type: "string" as const },
  },
};

export const mfaRequiredLoginResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status", "options", "preAuthCsrfToken"],
  properties: {
    status: { type: "string" as const, enum: ["MFA_REQUIRED"] },
    // The WebAuthn library owns the remaining option fields. challenge is the
    // actionable value required by the browser before an assertion can start.
    options: {
      type: "object" as const,
      required: ["challenge"],
      properties: { challenge: { type: "string" as const } },
    },
    preAuthCsrfToken: { type: "string" as const },
  },
};

export const loginResponseSchema = {
  oneOf: [authenticatedLoginResponseSchema, mfaRequiredLoginResponseSchema],
};

export const sessionActivationResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string" as const, enum: ["ok"] },
  },
};

export const csrfTokenResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["csrfToken"],
  properties: {
    csrfToken: { type: "string" as const },
  },
};
