export const PASSKEY_ENROLLMENT_REPOSITORY = Symbol("PASSKEY_ENROLLMENT_REPOSITORY");

export type PasskeyReauthenticationMaterial = {
  credentialVersion: number;
  deletedAt: Date | null;
  passwordHash: string;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
  userId: string;
};

export type PasskeyRegistrationContext = {
  activeCredentials: Array<{ credentialId: string; transports: string[] }>;
  displayName: string;
  email: string;
};

export type PasskeyChallengeClaim = {
  challengeId: string;
};

export type VerifiedPasskeyCredential = {
  backedUp: boolean;
  counter: bigint;
  credentialId: string;
  deviceType: "singleDevice" | "multiDevice";
  publicKey: Uint8Array;
  transports: string[];
};

export type PasskeyView = {
  backedUp: boolean | null;
  createdAt: Date;
  deviceType: string | null;
  displayName: string | null;
  id: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  transports: string[];
  updatedAt: Date;
};

export interface PasskeyEnrollmentRepository {
  getReauthenticationMaterial(userId: string, identitySessionId: string): Promise<PasskeyReauthenticationMaterial | null>;
  beginRegistration(input: {
    challengeHash: string;
    expectedCredentialVersion: number;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyRegistrationContext>;
  claimRegistrationChallenge(input: {
    challengeHash: string;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyChallengeClaim>;
  completeRegistration(input: {
    challengeId: string;
    credential: VerifiedPasskeyCredential;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyView>;
  listPasskeys(userId: string): Promise<PasskeyView[]>;
  renamePasskey(input: {
    displayName: string;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView>;
  revokePasskey(input: {
    expectedCredentialVersion: number;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView>;
}
