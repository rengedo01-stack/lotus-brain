import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";

export const PASSKEY_MFA_REPOSITORY = Symbol("PASSKEY_MFA_REPOSITORY");

export type MfaPasskeyCredential = {
  counter: bigint;
  credentialId: string;
  id: string;
  publicKey: Uint8Array;
  transports: string[];
};

export type MfaCredentialContext = {
  credential: MfaPasskeyCredential;
  ceremonyId: string;
  userId: string;
};

export type MfaReauthenticationMaterial = {
  authenticationPolicyVersion: number;
  credentialVersion: number;
  deletedAt: Date | null;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
};

export type MfaLoginUserView = {
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: Date | null;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
  updatedAt: Date;
};

export type MfaStepUpContext = {
  activeCredentials: Array<{ credentialId: string; transports: string[] }>;
};

export type MfaStatusView = {
  activePasskeyCount: number;
  enabled: boolean;
  recoveryEmailVerified: boolean;
};

export type MfaLoginTransactionContext = {
  activeCredentials: Array<{ credentialId: string; transports: string[] }>;
};

export interface PasskeyMfaRepository {
  getMfaStatus(userId: string): Promise<MfaStatusView>;
  getReauthenticationMaterial(userId: string, identitySessionId: string): Promise<MfaReauthenticationMaterial | null>;
  beginStepUp(input: {
    challengeHash: string;
    expectedAuthenticationPolicyVersion: number;
    expectedCredentialVersion: number;
    identitySessionId: string;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<MfaStepUpContext>;
  claimStepUp(input: {
    challengeHash: string;
    credentialId: string;
    identitySessionId: string;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<MfaCredentialContext>;
  completeStepUp(input: {
    challengeId: string;
    credentialId: string;
    expectedCounter: bigint;
    identitySessionId: string;
    newCounter: bigint;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<void>;
  beginMfaLogin(input: {
    authenticationPolicyVersion: number;
    challengeHash: string;
    credentialVersion: number;
    csrfTokenHash: string;
    transactionTokenHash: string;
    userId: string;
  }): Promise<MfaLoginTransactionContext>;
  claimMfaLogin(input: {
    challengeHash: string;
    credentialId: string;
    csrfTokenHash: string;
    transactionTokenHash: string;
  }): Promise<MfaCredentialContext>;
  completeMfaLogin(input: {
    challengeId: string;
    credentialId: string;
    csrfTokenHash: string;
    expectedCounter: bigint;
    ipAddress: string | null;
    newCounter: bigint;
    sessionCsrfTokenHash: string;
    pendingSessionExpiresAt: Date;
    sessionTokenHash: string;
    transactionTokenHash: string;
    userAgent: string | null;
  }): Promise<MfaLoginUserView>;
}

export type PasskeyAuthenticationOptions = PublicKeyCredentialRequestOptionsJSON;
