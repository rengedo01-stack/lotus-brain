import { Injectable } from "@nestjs/common";
import { Prisma, type UserStatus } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { PASSKEY_MFA_TRANSACTION_TTL_MS, PASSKEY_STEP_UP_TTL_MS } from "../auth.constants";
import {
  PasskeyMfaCeremonyInvalidError,
  PasskeyMfaConflictError,
  PasskeyMfaPrerequisiteError,
} from "../application/passkey-mfa.errors";
import type {
  MfaCredentialContext,
  MfaLoginTransactionContext,
  MfaLoginUserView,
  MfaPasskeyCredential,
  MfaReauthenticationMaterial,
  MfaStatusView,
  MfaStepUpContext,
  PasskeyMfaRepository,
} from "../application/passkey-mfa.repository";

type TransactionClient = Prisma.TransactionClient;

type LockedUser = {
  authenticationPolicyVersion: number;
  credentialVersion: number;
  deletedAt: Date | null;
  email: string;
  emailVerificationVersion: number;
  emailVerifiedAt: Date | null;
  id: string;
  passkeyMfaEnabledAt: Date | null;
  status: UserStatus;
};

type LockedSession = {
  activatedAt: Date | null;
  authenticationPolicyVersion: number;
  credentialVersion: number;
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  userId: string;
};

type LockedStepUpChallenge = {
  authenticationPolicyVersionSnapshot: number;
  challengeHash: string;
  consumedAt: Date | null;
  credentialVersionSnapshot: number;
  expiresAt: Date;
  id: string;
  identitySessionId: string;
  invalidatedAt: Date | null;
  purpose: "ENABLE_MFA" | "DISABLE_MFA";
  userId: string;
};

type LockedLoginTransaction = {
  authenticationPolicyVersionSnapshot: number;
  challengeHash: string;
  consumedAt: Date | null;
  credentialVersionSnapshot: number;
  csrfTokenHash: string;
  expiresAt: Date;
  id: string;
  transactionTokenHash: string;
  userId: string;
};

type LockedCredential = MfaPasskeyCredential & { revokedAt: Date | null; userId: string };

@Injectable()
export class PrismaPasskeyMfaRepository implements PasskeyMfaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getMfaStatus(userId: string): Promise<MfaStatusView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        passkeyMfaEnabledAt: true,
        emailVerifiedAt: true,
        _count: { select: { webAuthnCredentials: { where: { revokedAt: null } } } },
      },
    });
    if (user === null) throw this.invalidCeremony();
    return {
      enabled: user.passkeyMfaEnabledAt !== null,
      activePasskeyCount: user._count.webAuthnCredentials,
      recoveryEmailVerified: user.emailVerifiedAt !== null,
    };
  }

  async getReauthenticationMaterial(
    userId: string,
    identitySessionId: string,
  ): Promise<MfaReauthenticationMaterial | null> {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          passwordHash: true,
          credentialVersion: true,
          authenticationPolicyVersion: true,
          status: true,
          deletedAt: true,
        },
      }),
      this.prisma.identitySession.findUnique({
        where: { id: identitySessionId },
        select: {
          userId: true,
          credentialVersion: true,
          authenticationPolicyVersion: true,
          activatedAt: true,
          revokedAt: true,
          expiresAt: true,
        },
      }),
    ]);
    if (
      user === null ||
      session === null ||
      session.userId !== userId ||
      session.activatedAt === null ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.credentialVersion !== user.credentialVersion ||
      session.authenticationPolicyVersion !== user.authenticationPolicyVersion
    ) {
      return null;
    }
    return user;
  }

  async beginStepUp(input: {
    challengeHash: string;
    expectedAuthenticationPolicyVersion: number;
    expectedCredentialVersion: number;
    identitySessionId: string;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<MfaStepUpContext> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await this.lockUser(transaction, input.userId);
        const session = await this.lockSession(transaction, input.identitySessionId);
        const now = new Date();
        this.assertCurrentSession(user, session, input.userId, input.expectedCredentialVersion, input.expectedAuthenticationPolicyVersion, now);
        const activeCredentials = await this.activeCredentials(transaction, user.id);
        this.assertStepUpPrerequisites(user, activeCredentials.length, input.purpose);

        await transaction.webAuthnStepUpChallenge.updateMany({
          where: {
            userId: user.id,
            identitySessionId: session.id,
            purpose: input.purpose,
            consumedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        await transaction.webAuthnStepUpChallenge.create({
          data: {
            userId: user.id,
            identitySessionId: session.id,
            purpose: input.purpose,
            challengeHash: input.challengeHash,
            credentialVersionSnapshot: user.credentialVersion,
            authenticationPolicyVersionSnapshot: user.authenticationPolicyVersion,
            expiresAt: new Date(now.getTime() + PASSKEY_STEP_UP_TTL_MS),
          },
        });
        return { activeCredentials };
      });
    } catch (error: unknown) {
      if (this.isPrismaError(error, "P2002")) throw new PasskeyMfaConflictError("A passkey ceremony is already in progress.");
      throw error;
    }
  }

  async claimStepUp(input: {
    challengeHash: string;
    credentialId: string;
    identitySessionId: string;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<MfaCredentialContext> {
    const reference = await this.prisma.webAuthnStepUpChallenge.findUnique({
      where: { challengeHash: input.challengeHash },
      select: { id: true },
    });
    if (reference === null) throw this.invalidCeremony();

    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, input.userId);
      const session = await this.lockSession(transaction, input.identitySessionId);
      const challenge = await this.lockStepUpChallenge(transaction, reference.id);
      const now = new Date();
      this.assertCurrentSession(
        user,
        session,
        input.userId,
        challenge.credentialVersionSnapshot,
        challenge.authenticationPolicyVersionSnapshot,
        now,
      );
      if (
        challenge.userId !== user.id ||
        challenge.identitySessionId !== session.id ||
        challenge.purpose !== input.purpose ||
        challenge.challengeHash !== input.challengeHash ||
        challenge.consumedAt !== null ||
        challenge.invalidatedAt !== null ||
        challenge.expiresAt <= now
      ) {
        throw this.invalidCeremony();
      }
      await transaction.webAuthnStepUpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
      const credential = await this.lockCredential(transaction, user.id, input.credentialId);
      if (credential === null || credential.revokedAt !== null) throw this.invalidCeremony();
      return { ceremonyId: challenge.id, credential: this.toCredential(credential), userId: user.id };
    });
  }

  async completeStepUp(input: {
    challengeId: string;
    credentialId: string;
    expectedCounter: bigint;
    identitySessionId: string;
    newCounter: bigint;
    purpose: "ENABLE_MFA" | "DISABLE_MFA";
    userId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, input.userId);
      const session = await this.lockSession(transaction, input.identitySessionId);
      const challenge = await this.lockStepUpChallenge(transaction, input.challengeId);
      const credential = await this.lockCredentialById(transaction, user.id, input.credentialId);
      const now = new Date();
      if (credential === null || credential.revokedAt !== null) throw this.invalidCeremony();
      this.assertCurrentSession(
        user,
        session,
        input.userId,
        challenge.credentialVersionSnapshot,
        challenge.authenticationPolicyVersionSnapshot,
        now,
      );
      if (
        challenge.userId !== user.id ||
        challenge.identitySessionId !== session.id ||
        challenge.purpose !== input.purpose ||
        challenge.consumedAt === null ||
        challenge.invalidatedAt !== null ||
        challenge.expiresAt <= now ||
        credential.counter !== input.expectedCounter
      ) {
        throw this.invalidCeremony();
      }
      const activeCredentials = await this.activeCredentials(transaction, user.id);
      this.assertStepUpPrerequisites(user, activeCredentials.length, input.purpose);
      await transaction.webAuthnCredential.update({
        where: { id: credential.id },
        data: { counter: input.newCounter, lastUsedAt: now },
      });
      const enabling = input.purpose === "ENABLE_MFA";
      await transaction.user.update({
        where: { id: user.id },
        data: {
          passkeyMfaEnabledAt: enabling ? now : null,
          authenticationPolicyVersion: { increment: 1 },
        },
      });
      await transaction.identitySession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.identityCsrfToken.deleteMany({
        where: { identitySession: { userId: user.id } },
      });
      await transaction.identityAuditLog.create({
        data: {
          action: enabling ? "PASSKEY_MFA_ENABLED" : "PASSKEY_MFA_DISABLED",
          actorUserId: user.id,
          targetUserId: user.id,
          beforeState: { mfaEnabled: !enabling, authenticationPolicyVersion: user.authenticationPolicyVersion },
          afterState: { mfaEnabled: enabling, authenticationPolicyVersion: user.authenticationPolicyVersion + 1 },
        },
      });
      await transaction.notificationOutbox.create({
        data: {
          kind: enabling ? "PASSKEY_MFA_ENABLED" : "PASSKEY_MFA_DISABLED",
          userId: user.id,
          destinationAddress: user.email,
          emailVersionSnapshot: user.emailVerificationVersion,
        },
      });
    });
  }

  async beginMfaLogin(input: {
    authenticationPolicyVersion: number;
    challengeHash: string;
    credentialVersion: number;
    csrfTokenHash: string;
    transactionTokenHash: string;
    userId: string;
  }): Promise<MfaLoginTransactionContext> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, input.userId);
      const now = new Date();
      if (
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.passkeyMfaEnabledAt === null ||
        user.credentialVersion !== input.credentialVersion ||
        user.authenticationPolicyVersion !== input.authenticationPolicyVersion
      ) {
        throw this.invalidCeremony();
      }
      const activeCredentials = await this.activeCredentials(transaction, user.id);
      if (activeCredentials.length === 0) throw this.invalidCeremony();
      await transaction.passkeyMfaLoginTransaction.create({
        data: {
          userId: user.id,
          transactionTokenHash: input.transactionTokenHash,
          csrfTokenHash: input.csrfTokenHash,
          challengeHash: input.challengeHash,
          credentialVersionSnapshot: user.credentialVersion,
          authenticationPolicyVersionSnapshot: user.authenticationPolicyVersion,
          expiresAt: new Date(now.getTime() + PASSKEY_MFA_TRANSACTION_TTL_MS),
        },
      });
      return { activeCredentials };
    });
  }

  async claimMfaLogin(input: {
    challengeHash: string;
    credentialId: string;
    csrfTokenHash: string;
    transactionTokenHash: string;
  }): Promise<MfaCredentialContext> {
    const reference = await this.prisma.passkeyMfaLoginTransaction.findUnique({
      where: { transactionTokenHash: input.transactionTokenHash },
      select: { id: true },
    });
    if (reference === null) throw this.invalidCeremony();
    return this.prisma.$transaction(async (transaction) => {
      const ceremony = await this.lockLoginTransaction(transaction, reference.id);
      const user = await this.lockUser(transaction, ceremony.userId);
      const now = new Date();
      if (
        ceremony.transactionTokenHash !== input.transactionTokenHash ||
        ceremony.csrfTokenHash !== input.csrfTokenHash ||
        ceremony.challengeHash !== input.challengeHash ||
        ceremony.consumedAt !== null ||
        ceremony.expiresAt <= now ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.passkeyMfaEnabledAt === null ||
        user.credentialVersion !== ceremony.credentialVersionSnapshot ||
        user.authenticationPolicyVersion !== ceremony.authenticationPolicyVersionSnapshot
      ) {
        throw this.invalidCeremony();
      }
      // Valid possession of both pre-auth secrets buys exactly one assertion
      // attempt; a failed verification cannot be replayed with new payloads.
      await transaction.passkeyMfaLoginTransaction.update({ where: { id: ceremony.id }, data: { consumedAt: now } });
      const credential = await this.lockCredential(transaction, user.id, input.credentialId);
      if (credential === null || credential.revokedAt !== null) throw this.invalidCeremony();
      return { ceremonyId: ceremony.id, credential: this.toCredential(credential), userId: user.id };
    });
  }

  async completeMfaLogin(input: {
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
  }): Promise<MfaLoginUserView> {
    return this.prisma.$transaction(async (transaction) => {
      const ceremony = await this.lockLoginTransaction(transaction, input.challengeId);
      const user = await this.lockUser(transaction, ceremony.userId);
      const credential = await this.lockCredentialById(transaction, user.id, input.credentialId);
      const now = new Date();
      if (
        credential === null ||
        credential.revokedAt !== null ||
        ceremony.transactionTokenHash !== input.transactionTokenHash ||
        ceremony.csrfTokenHash !== input.csrfTokenHash ||
        ceremony.consumedAt === null ||
        ceremony.expiresAt <= now ||
        user.status !== "ACTIVE" ||
        user.deletedAt !== null ||
        user.passkeyMfaEnabledAt === null ||
        user.credentialVersion !== ceremony.credentialVersionSnapshot ||
        user.authenticationPolicyVersion !== ceremony.authenticationPolicyVersionSnapshot ||
        credential.counter !== input.expectedCounter
      ) {
        throw this.invalidCeremony();
      }
      await transaction.webAuthnCredential.update({
        where: { id: credential.id },
        data: { counter: input.newCounter, lastUsedAt: now },
      });
      await transaction.identitySession.create({
        data: {
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          csrfTokenHash: input.sessionCsrfTokenHash,
          credentialVersion: user.credentialVersion,
          authenticationPolicyVersion: user.authenticationPolicyVersion,
          expiresAt: input.pendingSessionExpiresAt,
          activatedAt: null,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        },
      });
      return transaction.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });
  }

  private async lockUser(transaction: TransactionClient, userId: string): Promise<LockedUser> {
    const users = await transaction.$queryRaw<LockedUser[]>(Prisma.sql`
      SELECT
        "id", "email", "credentialVersion", "authenticationPolicyVersion", "passkeyMfaEnabledAt",
        "emailVerifiedAt", "emailVerificationVersion", "status", "deletedAt"
      FROM "User"
      WHERE "id" = ${userId}
      FOR UPDATE
    `);
    const user = users[0] ?? null;
    if (user === null) throw this.invalidCeremony();
    return user;
  }

  private async lockSession(transaction: TransactionClient, sessionId: string): Promise<LockedSession> {
    const sessions = await transaction.$queryRaw<LockedSession[]>(Prisma.sql`
      SELECT "id", "userId", "credentialVersion", "authenticationPolicyVersion", "expiresAt", "activatedAt", "revokedAt"
      FROM "IdentitySession"
      WHERE "id" = ${sessionId}
      FOR UPDATE
    `);
    const session = sessions[0] ?? null;
    if (session === null) throw this.invalidCeremony();
    return session;
  }

  private async lockStepUpChallenge(transaction: TransactionClient, challengeId: string): Promise<LockedStepUpChallenge> {
    const rows = await transaction.$queryRaw<LockedStepUpChallenge[]>(Prisma.sql`
      SELECT
        "id", "userId", "identitySessionId", "purpose", "challengeHash",
        "credentialVersionSnapshot", "authenticationPolicyVersionSnapshot", "expiresAt", "consumedAt", "invalidatedAt"
      FROM "WebAuthnStepUpChallenge"
      WHERE "id" = ${challengeId}
      FOR UPDATE
    `);
    const challenge = rows[0] ?? null;
    if (challenge === null) throw this.invalidCeremony();
    return challenge;
  }

  private async lockLoginTransaction(transaction: TransactionClient, transactionId: string): Promise<LockedLoginTransaction> {
    const rows = await transaction.$queryRaw<LockedLoginTransaction[]>(Prisma.sql`
      SELECT
        "id", "userId", "transactionTokenHash", "csrfTokenHash", "challengeHash",
        "credentialVersionSnapshot", "authenticationPolicyVersionSnapshot", "expiresAt", "consumedAt"
      FROM "PasskeyMfaLoginTransaction"
      WHERE "id" = ${transactionId}
      FOR UPDATE
    `);
    const ceremony = rows[0] ?? null;
    if (ceremony === null) throw this.invalidCeremony();
    return ceremony;
  }

  private async lockCredential(
    transaction: TransactionClient,
    userId: string,
    credentialId: string,
  ): Promise<LockedCredential | null> {
    const rows = await transaction.$queryRaw<LockedCredential[]>(Prisma.sql`
      SELECT "id", "userId", "credentialId", "publicKey", "counter", "transports", "revokedAt"
      FROM "WebAuthnCredential"
      WHERE "userId" = ${userId} AND "credentialId" = ${credentialId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockCredentialById(
    transaction: TransactionClient,
    userId: string,
    credentialRecordId: string,
  ): Promise<LockedCredential | null> {
    const rows = await transaction.$queryRaw<LockedCredential[]>(Prisma.sql`
      SELECT "id", "userId", "credentialId", "publicKey", "counter", "transports", "revokedAt"
      FROM "WebAuthnCredential"
      WHERE "userId" = ${userId} AND "id" = ${credentialRecordId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async activeCredentials(
    transaction: TransactionClient,
    userId: string,
  ): Promise<Array<{ credentialId: string; transports: string[] }>> {
    return transaction.webAuthnCredential.findMany({
      where: { userId, revokedAt: null },
      select: { credentialId: true, transports: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  private assertCurrentSession(
    user: LockedUser,
    session: LockedSession,
    userId: string,
    expectedCredentialVersion: number,
    expectedAuthenticationPolicyVersion: number,
    now: Date,
  ): void {
    if (
      user.id !== userId ||
      user.status !== "ACTIVE" ||
      user.deletedAt !== null ||
      user.credentialVersion !== expectedCredentialVersion ||
      user.authenticationPolicyVersion !== expectedAuthenticationPolicyVersion ||
      session.userId !== user.id ||
      session.activatedAt === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.credentialVersion !== user.credentialVersion ||
      session.authenticationPolicyVersion !== user.authenticationPolicyVersion
    ) {
      throw this.invalidCeremony();
    }
  }

  private assertStepUpPrerequisites(
    user: LockedUser,
    activePasskeyCount: number,
    purpose: "ENABLE_MFA" | "DISABLE_MFA",
  ): void {
    if (user.status !== "ACTIVE" || user.deletedAt !== null || activePasskeyCount < 1) {
      throw new PasskeyMfaPrerequisiteError("MFA prerequisites are not satisfied.");
    }
    if (purpose === "ENABLE_MFA") {
      if (user.passkeyMfaEnabledAt !== null) throw new PasskeyMfaConflictError("Passkey MFA is already enabled.");
      if (user.emailVerifiedAt === null) {
        throw new PasskeyMfaPrerequisiteError("A verified recovery email is required to enable passkey MFA.");
      }
      return;
    }
    if (user.passkeyMfaEnabledAt === null) throw new PasskeyMfaConflictError("Passkey MFA is not enabled.");
  }

  private toCredential(credential: LockedCredential): MfaPasskeyCredential {
    return {
      id: credential.id,
      credentialId: credential.credentialId,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: [...credential.transports],
    };
  }

  private invalidCeremony(): PasskeyMfaCeremonyInvalidError {
    return new PasskeyMfaCeremonyInvalidError("Passkey MFA ceremony is invalid or expired.");
  }

  private isPrismaError(error: unknown, code: string): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === code;
  }
}
