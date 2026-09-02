import type { IdentitySession, User } from "../../../generated/prisma/client";

export type AuthUserView = Pick<
  User,
  "id" | "email" | "displayName" | "status" | "lastLoginAt" | "createdAt" | "updatedAt"
>;

export type AuthSessionUserView = AuthUserView & Pick<User, "deletedAt" | "credentialVersion" | "authenticationPolicyVersion">;

export type AuthLoginUserView = AuthUserView & Pick<
  User,
  "deletedAt" | "credentialVersion" | "authenticationPolicyVersion" | "passkeyMfaEnabledAt"
>;

export type AuthPasswordCredentialView = Pick<
  User,
  "id" | "passwordHash" | "credentialVersion" | "authenticationPolicyVersion" | "status" | "deletedAt"
>;

export type AuthSessionView = Pick<
  IdentitySession,
  "id" | "userId" | "credentialVersion" | "authenticationPolicyVersion" | "expiresAt" | "activatedAt" | "revokedAt" | "csrfTokenHash" | "lastSeenAt"
>;

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type ChangePasswordInput = {
  userId: string;
  expectedCredentialVersion: number;
  passwordHash: string;
};

export type BootstrapUserInput = {
  email: string;
  displayName: string;
  password: string;
};

export interface AuthRepository {
  findUserByEmail(email: string): Promise<(AuthLoginUserView & { passwordHash: string }) | null>;
  findUserCredentialById(userId: string): Promise<AuthPasswordCredentialView | null>;
  findUserById(id: string): Promise<AuthUserView | null>;
  findSessionByTokenHash(tokenHash: string): Promise<
    (AuthSessionView & { user: AuthSessionUserView | null }) | null
  >;
  createPendingSession(input: {
    userId: string;
    credentialVersion: number;
    authenticationPolicyVersion: number;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthSessionView>;
  activateSession(input: {
    csrfTokenHash: string;
    expiresAt: Date;
    tokenHash: string;
  }): Promise<"ACTIVATED" | "ALREADY_ACTIVATED" | "CSRF_INVALID" | "UNAUTHORIZED">;
  changePassword(input: ChangePasswordInput): Promise<void>;
  issueSessionCsrfToken(input: {
    sessionId: string;
    csrfTokenHash: string;
    mirrorLegacyScalar: boolean;
  }): Promise<AuthSessionView | null>;
  isSessionCsrfTokenValid(input: {
    sessionId: string;
    csrfTokenHash: string;
    allowLegacyScalarFallback: boolean;
  }): Promise<boolean>;
  revokeSession(sessionId: string): Promise<boolean>;
  touchSession(sessionId: string, lastSeenAt: Date): Promise<void>;
  getUserCount(): Promise<number>;
  bootstrapUser(input: { email: string; displayName: string; passwordHash: string }): Promise<AuthUserView>;
}

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");
