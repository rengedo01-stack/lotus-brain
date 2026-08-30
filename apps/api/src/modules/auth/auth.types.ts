import type { Request } from "express";
import type { IdentitySession, User } from "../../generated/prisma/client";

export type AuthenticatedRequestUser = Pick<
  User,
  "id" | "email" | "displayName" | "status" | "lastLoginAt" | "createdAt" | "updatedAt"
>;

export type AuthenticatedRequestSession = Pick<
  IdentitySession,
  "id" | "userId" | "credentialVersion" | "authenticationPolicyVersion" | "expiresAt" | "activatedAt" | "revokedAt" | "csrfTokenHash" | "lastSeenAt"
>;

export type PendingSessionActivation = Pick<
  IdentitySession,
  "id" | "userId" | "credentialVersion" | "authenticationPolicyVersion"
> & {
  csrfTokenHash: string;
  tokenHash: string;
};

export type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedRequestUser;
  authSession?: AuthenticatedRequestSession;
  pendingSessionActivation?: PendingSessionActivation;
};

export type LoginResponse = {
  user: AuthenticatedRequestUser;
  csrfToken: string;
} | {
  status: "MFA_REQUIRED";
  options: object;
  preAuthCsrfToken: string;
};
