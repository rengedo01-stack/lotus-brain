import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verify } from "argon2";
import type { EnvironmentVariables } from "../../../config/environment";
import { AuthInvalidCredentialsError } from "../auth.errors";
import { hashSecret, makeOpaqueToken } from "../auth.utils";
import {
  PASSKEY_ENROLLMENT_REPOSITORY,
  type PasskeyEnrollmentRepository,
  type PasskeyView,
} from "./passkey-enrollment.repository";
import { PasskeyValidationError } from "./passkey-enrollment.errors";
import {
  PASSKEY_WEBAUTHN_ADAPTER,
  type PasskeyRegistrationOptions,
  type PasskeyWebAuthnAdapter,
} from "./passkey-webauthn.adapter";
import { PASSKEY_DISPLAY_NAME_MAX_CODE_POINTS } from "./passkey-enrollment.constants";

@Injectable()
export class PasskeyEnrollmentService {
  constructor(
    @Inject(PASSKEY_ENROLLMENT_REPOSITORY)
    private readonly repository: PasskeyEnrollmentRepository,
    @Inject(PASSKEY_WEBAUTHN_ADAPTER)
    private readonly webAuthn: PasskeyWebAuthnAdapter,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async beginRegistration(input: {
    currentPassword: string;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyRegistrationOptions> {
    const credential = await this.requireCurrentPassword(input.userId, input.identitySessionId, input.currentPassword);
    const challenge = makeOpaqueToken();
    const context = await this.repository.beginRegistration({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      expectedCredentialVersion: credential.credentialVersion,
      challengeHash: hashSecret(challenge),
    });
    return this.webAuthn.generateRegistrationOptions({
      context,
      challenge,
      rpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
      rpName: this.configService.get("WEBAUTHN_RP_NAME", { infer: true }),
      userId: input.userId,
    });
  }

  async verifyRegistration(input: {
    identitySessionId: string;
    registrationResponse: unknown;
    userId: string;
  }): Promise<PasskeyView> {
    const challenge = this.webAuthn.extractChallenge(input.registrationResponse);
    const claim = await this.repository.claimRegistrationChallenge({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      challengeHash: hashSecret(challenge),
    });
    const verifiedCredential = await this.webAuthn.verifyRegistrationResponse({
      registrationResponse: input.registrationResponse,
      expectedChallenge: challenge,
      expectedOrigin: this.configService.get("WEBAUTHN_ORIGIN", { infer: true }),
      expectedRpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
    });
    return this.repository.completeRegistration({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      challengeId: claim.challengeId,
      credential: verifiedCredential,
    });
  }

  listPasskeys(userId: string): Promise<PasskeyView[]> {
    return this.repository.listPasskeys(userId);
  }

  async renamePasskey(input: {
    displayName: string;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView> {
    return this.repository.renamePasskey({
      ...input,
      displayName: this.normalizeDisplayName(input.displayName),
    });
  }

  async revokePasskey(input: {
    currentPassword: string;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView> {
    const credential = await this.requireCurrentPassword(input.userId, input.identitySessionId, input.currentPassword);
    return this.repository.revokePasskey({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      passkeyId: input.passkeyId,
      expectedCredentialVersion: credential.credentialVersion,
    });
  }

  private async requireCurrentPassword(userId: string, identitySessionId: string, currentPassword: string) {
    const credential = await this.repository.getReauthenticationMaterial(userId, identitySessionId);
    if (
      credential === null ||
      credential.status !== "ACTIVE" ||
      credential.deletedAt !== null ||
      !await verify(credential.passwordHash, currentPassword)
    ) {
      throw new AuthInvalidCredentialsError("Invalid credentials.");
    }
    return credential;
  }

  private normalizeDisplayName(value: string): string {
    const normalized = value.normalize("NFC").trim();
    if (normalized.length === 0 || Array.from(normalized).length > PASSKEY_DISPLAY_NAME_MAX_CODE_POINTS) {
      throw new PasskeyValidationError("Passkey display name is invalid.");
    }
    return normalized;
  }
}
