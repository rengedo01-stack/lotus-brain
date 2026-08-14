import type { PasskeyRegistrationContext, VerifiedPasskeyCredential } from "./passkey-enrollment.repository";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import type { MfaPasskeyCredential } from "./passkey-mfa.repository";

export const PASSKEY_WEBAUTHN_ADAPTER = Symbol("PASSKEY_WEBAUTHN_ADAPTER");

export type PasskeyRegistrationOptions = PublicKeyCredentialCreationOptionsJSON;
export type PasskeyAuthenticationOptions = PublicKeyCredentialRequestOptionsJSON;

export type VerifiedPasskeyAssertion = {
  credentialId: string;
  newCounter: bigint;
};

export interface PasskeyWebAuthnAdapter {
  extractChallenge(registrationResponse: unknown): string;
  generateRegistrationOptions(input: {
    context: PasskeyRegistrationContext;
    challenge: string;
    rpId: string;
    rpName: string;
    userId: string;
  }): Promise<PasskeyRegistrationOptions>;
  verifyRegistrationResponse(input: {
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    registrationResponse: unknown;
  }): Promise<VerifiedPasskeyCredential>;
  extractAuthenticationChallenge(authenticationResponse: unknown): string;
  extractAuthenticationCredentialId(authenticationResponse: unknown): string;
  generateAuthenticationOptions(input: {
    activeCredentials: Array<{ credentialId: string; transports: string[] }>;
    challenge: string;
    rpId: string;
  }): Promise<PasskeyAuthenticationOptions>;
  verifyAuthenticationResponse(input: {
    assertionResponse: unknown;
    credential: MfaPasskeyCredential;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    expectedUserId: string;
  }): Promise<VerifiedPasskeyAssertion>;
}
