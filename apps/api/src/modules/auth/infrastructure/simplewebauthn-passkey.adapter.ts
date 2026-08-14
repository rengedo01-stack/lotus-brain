import { Injectable } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  decodeClientDataJSON,
  isoBase64URL,
  isoUint8Array,
} from "@simplewebauthn/server/helpers";
import { timingSafeEqual } from "node:crypto";
import { hashSecret } from "../auth.utils";
import { PasskeyCeremonyInvalidError } from "../application/passkey-enrollment.errors";
import type { PasskeyRegistrationContext, VerifiedPasskeyCredential } from "../application/passkey-enrollment.repository";
import type { MfaPasskeyCredential } from "../application/passkey-mfa.repository";
import type {
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
  PasskeyWebAuthnAdapter,
  VerifiedPasskeyAssertion,
} from "../application/passkey-webauthn.adapter";

type RegistrationResponseShape = {
  response?: { clientDataJSON?: unknown };
};

type AuthenticationResponseShape = {
  id?: unknown;
  response?: { authenticatorData?: unknown; clientDataJSON?: unknown; userHandle?: unknown };
};

const AUTHENTICATOR_DATA_FLAGS_OFFSET = 32;
const AUTHENTICATOR_DATA_MINIMUM_LENGTH = 37;
const USER_PRESENT_FLAG = 0x01;
const USER_VERIFIED_FLAG = 0x04;

@Injectable()
export class SimpleWebAuthnPasskeyAdapter implements PasskeyWebAuthnAdapter {
  extractChallenge(registrationResponse: unknown): string {
    try {
      const clientDataJSON = this.getClientDataJson(registrationResponse);
      const challenge = decodeClientDataJSON(clientDataJSON).challenge;
      const rawChallenge = isoBase64URL.toUTF8String(challenge);
      if (!/^[A-Za-z0-9_-]{43}$/.test(rawChallenge)) throw new Error("Unexpected WebAuthn challenge.");
      return rawChallenge;
    } catch {
      throw new PasskeyCeremonyInvalidError("Passkey registration is invalid or expired.");
    }
  }

  async generateRegistrationOptions(input: {
    context: PasskeyRegistrationContext;
    challenge: string;
    rpId: string;
    rpName: string;
    userId: string;
  }): Promise<PasskeyRegistrationOptions> {
    return generateRegistrationOptions({
      rpName: input.rpName,
      rpID: input.rpId,
      userName: input.context.email,
      userDisplayName: input.context.displayName,
      userID: isoUint8Array.fromUTF8String(input.userId),
      challenge: input.challenge,
      timeout: 5 * 60 * 1_000,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: input.context.activeCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">,
      })),
    });
  }

  async verifyRegistrationResponse(input: {
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    registrationResponse: unknown;
  }): Promise<VerifiedPasskeyCredential> {
    try {
      const clientData = decodeClientDataJSON(this.getClientDataJson(input.registrationResponse));
      if (clientData.crossOrigin === true) {
        throw new Error("Cross-origin WebAuthn registration is not permitted.");
      }
      const verification = await verifyRegistrationResponse({
        response: input.registrationResponse as never,
        expectedChallenge: (responseChallenge) => this.matchesChallenge(input.expectedChallenge, responseChallenge),
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRpId,
        requireUserPresence: true,
        requireUserVerification: true,
      });
      if (!verification.verified) throw new Error("WebAuthn registration was not verified.");

      const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
      if (!Number.isSafeInteger(credential.counter) || credential.counter < 0 || credential.counter > 0xFFFF_FFFF) {
        throw new Error("WebAuthn counter is invalid.");
      }
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: BigInt(credential.counter),
        transports: [...(credential.transports ?? [])],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      };
    } catch (error: unknown) {
      if (error instanceof PasskeyCeremonyInvalidError) throw error;
      throw new PasskeyCeremonyInvalidError("Passkey registration is invalid or expired.");
    }
  }

  extractAuthenticationChallenge(authenticationResponse: unknown): string {
    try {
      const clientDataJSON = this.getAuthenticationClientDataJson(authenticationResponse);
      const challenge = decodeClientDataJSON(clientDataJSON).challenge;
      const rawChallenge = isoBase64URL.toUTF8String(challenge);
      if (!/^[A-Za-z0-9_-]{43}$/.test(rawChallenge)) throw new Error("Unexpected WebAuthn challenge.");
      return rawChallenge;
    } catch {
      throw new PasskeyCeremonyInvalidError("Passkey assertion is invalid or expired.");
    }
  }

  extractAuthenticationCredentialId(authenticationResponse: unknown): string {
    if (typeof authenticationResponse !== "object" || authenticationResponse === null) {
      throw new PasskeyCeremonyInvalidError("Passkey assertion is invalid or expired.");
    }
    const credentialId = (authenticationResponse as AuthenticationResponseShape).id;
    if (typeof credentialId !== "string" || !/^[A-Za-z0-9_-]{16,2048}$/.test(credentialId)) {
      throw new PasskeyCeremonyInvalidError("Passkey assertion is invalid or expired.");
    }
    return credentialId;
  }

  async generateAuthenticationOptions(input: {
    activeCredentials: Array<{ credentialId: string; transports: string[] }>;
    challenge: string;
    rpId: string;
  }): Promise<PasskeyAuthenticationOptions> {
    return generateAuthenticationOptions({
      rpID: input.rpId,
      challenge: input.challenge,
      timeout: 5 * 60 * 1_000,
      userVerification: "required",
      allowCredentials: input.activeCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">,
      })),
    });
  }

  async verifyAuthenticationResponse(input: {
    assertionResponse: unknown;
    credential: MfaPasskeyCredential;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    expectedUserId: string;
  }): Promise<VerifiedPasskeyAssertion> {
    try {
      const clientData = decodeClientDataJSON(this.getAuthenticationClientDataJson(input.assertionResponse));
      if (clientData.crossOrigin === true) throw new Error("Cross-origin WebAuthn assertion is not permitted.");
      this.assertExpectedUserHandle(input.assertionResponse, input.expectedUserId);
      const counter = Number(input.credential.counter);
      if (!Number.isSafeInteger(counter) || counter < 0 || counter > 0xFFFF_FFFF) {
        throw new Error("WebAuthn counter is invalid.");
      }
      const verification = await verifyAuthenticationResponse({
        response: input.assertionResponse as never,
        expectedChallenge: (responseChallenge) => this.matchesChallenge(input.expectedChallenge, responseChallenge),
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRpId,
        credential: {
          id: input.credential.credentialId,
          publicKey: Uint8Array.from(input.credential.publicKey),
          counter,
          transports: input.credential.transports as Array<"ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb">,
        },
        requireUserVerification: true,
        advancedFIDOConfig: { userVerification: "required" },
      });
      if (!verification.verified || !verification.authenticationInfo.userVerified) {
        throw new Error("WebAuthn assertion was not verified.");
      }
      // The library has verified the signature over authenticatorData.  Lotus
      // BRAIN then applies its stricter MFA policy to those signed flags.
      this.assertUserPresenceAndVerification(input.assertionResponse);
      const newCounter = verification.authenticationInfo.newCounter;
      if (!Number.isSafeInteger(newCounter) || newCounter < 0 || newCounter > 0xFFFF_FFFF) {
        throw new Error("WebAuthn counter is invalid.");
      }
      return { credentialId: verification.authenticationInfo.credentialID, newCounter: BigInt(newCounter) };
    } catch (error: unknown) {
      if (error instanceof PasskeyCeremonyInvalidError) throw error;
      throw new PasskeyCeremonyInvalidError("Passkey assertion is invalid or expired.");
    }
  }

  private getClientDataJson(registrationResponse: unknown): string {
    if (typeof registrationResponse !== "object" || registrationResponse === null) {
      throw new Error("Registration response must be an object.");
    }
    const clientDataJSON = (registrationResponse as RegistrationResponseShape).response?.clientDataJSON;
    if (typeof clientDataJSON !== "string" || clientDataJSON.length === 0) {
      throw new Error("Registration response has no client data.");
    }
    return clientDataJSON;
  }

  private getAuthenticationClientDataJson(authenticationResponse: unknown): string {
    if (typeof authenticationResponse !== "object" || authenticationResponse === null) {
      throw new Error("Authentication response must be an object.");
    }
    const clientDataJSON = (authenticationResponse as AuthenticationResponseShape).response?.clientDataJSON;
    if (typeof clientDataJSON !== "string" || clientDataJSON.length === 0) {
      throw new Error("Authentication response has no client data.");
    }
    return clientDataJSON;
  }

  private assertUserPresenceAndVerification(authenticationResponse: unknown): void {
    if (typeof authenticationResponse !== "object" || authenticationResponse === null) {
      throw new Error("Authentication response must be an object.");
    }
    const authenticatorData = (authenticationResponse as AuthenticationResponseShape).response?.authenticatorData;
    if (typeof authenticatorData !== "string" || authenticatorData.length === 0) {
      throw new Error("Authentication response has no authenticator data.");
    }
    const bytes = isoBase64URL.toBuffer(authenticatorData);
    if (bytes.byteLength < AUTHENTICATOR_DATA_MINIMUM_LENGTH) {
      throw new Error("Authenticator data is too short.");
    }
    const flags = bytes[AUTHENTICATOR_DATA_FLAGS_OFFSET];
    if (
      (flags & USER_PRESENT_FLAG) !== USER_PRESENT_FLAG ||
      (flags & USER_VERIFIED_FLAG) !== USER_VERIFIED_FLAG
    ) {
      throw new Error("Passkey MFA requires user presence and verification.");
    }
  }

  private assertExpectedUserHandle(authenticationResponse: unknown, expectedUserId: string): void {
    const userHandle = (authenticationResponse as AuthenticationResponseShape).response?.userHandle;
    if (userHandle === undefined || userHandle === null) return;
    if (typeof userHandle !== "string" || isoBase64URL.toUTF8String(userHandle) !== expectedUserId) {
      throw new Error("WebAuthn assertion user handle does not match the authenticated user.");
    }
  }

  private matchesChallenge(expectedRawChallenge: string, responseChallenge: string): boolean {
    try {
      const actualRawChallenge = isoBase64URL.toUTF8String(responseChallenge);
      const expectedHash = Buffer.from(hashSecret(expectedRawChallenge), "hex");
      const actualHash = Buffer.from(hashSecret(actualRawChallenge), "hex");
      return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
    } catch {
      return false;
    }
  }
}
