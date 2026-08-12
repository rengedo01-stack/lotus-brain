import type { IdentitySession, User } from "../../../generated/prisma/client";

export type AuthUserView = Pick<
  User,
  "id" | "email" | "displayName" | "status" | "lastLoginAt" | "createdAt" | "updatedAt"
>;

export type AuthSessionUserView = AuthUserView & Pick<User, "deletedAt">;

export type AuthLoginUserView = AuthUserView & Pick<User, "deletedAt">;

export type AuthSessionView = Pick<
  IdentitySession,
  "id" | "userId" | "expiresAt" | "revokedAt" | "csrfTokenHash" | "lastSeenAt"
>;

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type BootstrapUserInput = {
  email: string;
  displayName: string;
  password: string;
};

export interface AuthRepository {
  findUserByEmail(email: string): Promise<(AuthLoginUserView & { passwordHash: string }) | null>;
  findUserById(id: string): Promise<AuthUserView | null>;
  findSessionByTokenHash(tokenHash: string): Promise<
    (AuthSessionView & { user: AuthSessionUserView | null }) | null
  >;
  createSession(input: {
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<AuthSessionView>;
  rotateSessionCsrfToken(sessionId: string, csrfTokenHash: string): Promise<AuthSessionView | null>;
  revokeSession(sessionId: string): Promise<boolean>;
  touchSession(sessionId: string, lastSeenAt: Date): Promise<void>;
  markUserLogin(userId: string, loggedInAt: Date): Promise<void>;
  getUserCount(): Promise<number>;
  bootstrapUser(input: { email: string; displayName: string; passwordHash: string }): Promise<AuthUserView>;
}

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");
