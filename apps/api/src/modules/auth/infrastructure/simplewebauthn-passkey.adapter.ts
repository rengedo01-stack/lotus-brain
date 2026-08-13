import { Injectable } from "@nestjs/common";
import {
  generateRegistrationOptions,
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
import type { PasskeyRegistrationOptions, PasskeyWebAuthnAdapter } from "../application/passkey-webauthn.adapter";

type RegistrationResponseShape = {
  response?: { clientDataJSON?: unknown };
};

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
