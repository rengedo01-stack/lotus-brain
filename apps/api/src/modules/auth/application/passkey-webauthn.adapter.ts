import type { PasskeyRegistrationContext, VerifiedPasskeyCredential } from "./passkey-enrollment.repository";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";

export const PASSKEY_WEBAUTHN_ADAPTER = Symbol("PASSKEY_WEBAUTHN_ADAPTER");

export type PasskeyRegistrationOptions = PublicKeyCredentialCreationOptionsJSON;

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
}
