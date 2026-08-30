import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verify } from "argon2";
import type { EnvironmentVariables } from "../../../config/environment";
import { PENDING_SESSION_TTL_MS } from "../auth.constants";
import { AuthInvalidCredentialsError } from "../auth.errors";
import { hashSecret, makeOpaqueToken } from "../auth.utils";
import {
  PASSKEY_MFA_REPOSITORY,
  type MfaLoginUserView,
  type MfaStatusView,
  type PasskeyAuthenticationOptions,
  type PasskeyMfaRepository,
} from "./passkey-mfa.repository";
import {
  PasskeyMfaCeremonyInvalidError,
  PasskeyMfaConflictError,
  PasskeyMfaPrerequisiteError,
} from "./passkey-mfa.errors";
import { PASSKEY_WEBAUTHN_ADAPTER, type PasskeyWebAuthnAdapter } from "./passkey-webauthn.adapter";

type StepUpPurpose = "ENABLE_MFA" | "DISABLE_MFA";

export type MfaRequiredLogin = {
  options: PasskeyAuthenticationOptions;
  preAuthCsrfToken: string;
  preAuthToken: string;
};

export type MfaLoginSuccess = {
  csrfToken: string;
  sessionToken: string;
  user: MfaLoginUserView;
};

@Injectable()
export class PasskeyMfaService {
  constructor(
    @Inject(PASSKEY_MFA_REPOSITORY)
    private readonly repository: PasskeyMfaRepository,
    @Inject(PASSKEY_WEBAUTHN_ADAPTER)
    private readonly webAuthn: PasskeyWebAuthnAdapter,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  getStatus(userId: string): Promise<MfaStatusView> {
    return this.repository.getMfaStatus(userId);
  }

  async beginEnable(input: { currentPassword: string; identitySessionId: string; userId: string }): Promise<PasskeyAuthenticationOptions> {
    return this.beginStepUp({ ...input, purpose: "ENABLE_MFA" });
  }

  async verifyEnable(input: { identitySessionId: string; response: unknown; userId: string }): Promise<void> {
    return this.verifyStepUp({ ...input, purpose: "ENABLE_MFA" });
  }

  async beginDisable(input: { currentPassword: string; identitySessionId: string; userId: string }): Promise<PasskeyAuthenticationOptions> {
    return this.beginStepUp({ ...input, purpose: "DISABLE_MFA" });
  }

  async verifyDisable(input: { identitySessionId: string; response: unknown; userId: string }): Promise<void> {
    return this.verifyStepUp({ ...input, purpose: "DISABLE_MFA" });
  }

  async beginMfaLogin(input: {
    authenticationPolicyVersion: number;
    credentialVersion: number;
    userId: string;
  }): Promise<MfaRequiredLogin> {
    const challenge = makeOpaqueToken();
    const preAuthToken = makeOpaqueToken();
    const preAuthCsrfToken = makeOpaqueToken();
    const context = await this.repository.beginMfaLogin({
      userId: input.userId,
      credentialVersion: input.credentialVersion,
      authenticationPolicyVersion: input.authenticationPolicyVersion,
      challengeHash: hashSecret(challenge),
      transactionTokenHash: hashSecret(preAuthToken),
      csrfTokenHash: hashSecret(preAuthCsrfToken),
    });
    const options = await this.webAuthn.generateAuthenticationOptions({
      activeCredentials: context.activeCredentials,
      challenge,
      rpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
    });
    return { options, preAuthToken, preAuthCsrfToken };
  }

  async verifyMfaLogin(input: {
    assertionResponse: unknown;
    ipAddress: string | null;
    preAuthCsrfToken: string;
    preAuthToken: string;
    userAgent: string | null;
  }): Promise<MfaLoginSuccess> {
    const challenge = this.webAuthn.extractAuthenticationChallenge(input.assertionResponse);
    const credentialId = this.webAuthn.extractAuthenticationCredentialId(input.assertionResponse);
    const transactionTokenHash = hashSecret(input.preAuthToken);
    const csrfTokenHash = hashSecret(input.preAuthCsrfToken);
    const claim = await this.repository.claimMfaLogin({
      transactionTokenHash,
      csrfTokenHash,
      challengeHash: hashSecret(challenge),
      credentialId,
    });
    const verified = await this.webAuthn.verifyAuthenticationResponse({
      assertionResponse: input.assertionResponse,
      credential: claim.credential,
      expectedChallenge: challenge,
      expectedOrigin: this.configService.get("WEBAUTHN_ORIGIN", { infer: true }),
      expectedRpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
      expectedUserId: claim.userId,
    });
    if (verified.credentialId !== claim.credential.credentialId) throw this.invalidCeremony();

    const sessionToken = makeOpaqueToken();
    const csrfToken = makeOpaqueToken();
    const pendingSessionExpiresAt = new Date(Date.now() + PENDING_SESSION_TTL_MS);
    const user = await this.repository.completeMfaLogin({
      challengeId: claim.ceremonyId,
      credentialId: claim.credential.id,
      expectedCounter: claim.credential.counter,
      newCounter: verified.newCounter,
      transactionTokenHash,
      csrfTokenHash,
      sessionTokenHash: hashSecret(sessionToken),
      sessionCsrfTokenHash: hashSecret(csrfToken),
      pendingSessionExpiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });
    return { user, sessionToken, csrfToken };
  }

  private async beginStepUp(input: {
    currentPassword: string;
    identitySessionId: string;
    purpose: StepUpPurpose;
    userId: string;
  }): Promise<PasskeyAuthenticationOptions> {
    const reauthentication = await this.repository.getReauthenticationMaterial(input.userId, input.identitySessionId);
    if (
      reauthentication === null ||
      reauthentication.status !== "ACTIVE" ||
      reauthentication.deletedAt !== null ||
      !await verify(reauthentication.passwordHash, input.currentPassword)
    ) {
      throw new AuthInvalidCredentialsError("Invalid credentials.");
    }
    const challenge = makeOpaqueToken();
    const context = await this.repository.beginStepUp({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      purpose: input.purpose,
      expectedCredentialVersion: reauthentication.credentialVersion,
      expectedAuthenticationPolicyVersion: reauthentication.authenticationPolicyVersion,
      challengeHash: hashSecret(challenge),
    });
    return this.webAuthn.generateAuthenticationOptions({
      activeCredentials: context.activeCredentials,
      challenge,
      rpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
    });
  }

  private async verifyStepUp(input: {
    identitySessionId: string;
    purpose: StepUpPurpose;
    response: unknown;
    userId: string;
  }): Promise<void> {
    const challenge = this.webAuthn.extractAuthenticationChallenge(input.response);
    const credentialId = this.webAuthn.extractAuthenticationCredentialId(input.response);
    const claim = await this.repository.claimStepUp({
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      purpose: input.purpose,
      challengeHash: hashSecret(challenge),
      credentialId,
    });
    const verified = await this.webAuthn.verifyAuthenticationResponse({
      assertionResponse: input.response,
      credential: claim.credential,
      expectedChallenge: challenge,
      expectedOrigin: this.configService.get("WEBAUTHN_ORIGIN", { infer: true }),
      expectedRpId: this.configService.get("WEBAUTHN_RP_ID", { infer: true }),
      expectedUserId: input.userId,
    });
    if (verified.credentialId !== claim.credential.credentialId) throw this.invalidCeremony();
    await this.repository.completeStepUp({
      challengeId: claim.ceremonyId,
      credentialId: claim.credential.id,
      expectedCounter: claim.credential.counter,
      newCounter: verified.newCounter,
      userId: input.userId,
      identitySessionId: input.identitySessionId,
      purpose: input.purpose,
    });
  }

  private invalidCeremony(): PasskeyMfaCeremonyInvalidError {
    return new PasskeyMfaCeremonyInvalidError("Passkey MFA ceremony is invalid or expired.");
  }
}

export {
  PasskeyMfaCeremonyInvalidError,
  PasskeyMfaConflictError,
  PasskeyMfaPrerequisiteError,
};
