export const notificationRequestAcceptedResponseSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: { type: "string" as const, enum: ["accepted"] },
  },
};
