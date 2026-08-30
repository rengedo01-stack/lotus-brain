import { Injectable } from "@nestjs/common";
import { Prisma, type UserStatus } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { PASSKEY_REGISTRATION_TTL_MS } from "../application/passkey-enrollment.constants";
import {
  PasskeyCeremonyInvalidError,
  PasskeyConflictError,
  PasskeyNotFoundError,
} from "../application/passkey-enrollment.errors";
import type {
  PasskeyChallengeClaim,
  PasskeyEnrollmentRepository,
  PasskeyReauthenticationMaterial,
  PasskeyRegistrationContext,
  PasskeyView,
  VerifiedPasskeyCredential,
} from "../application/passkey-enrollment.repository";

type TransactionClient = Prisma.TransactionClient;

type LockedUser = {
  authenticationPolicyVersion: number;
  credentialVersion: number;
  deletedAt: Date | null;
  displayName: string;
  email: string;
  emailVerificationVersion: number;
  id: string;
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

type LockedChallenge = {
  challengeHash: string;
  consumedAt: Date | null;
  credentialVersionSnapshot: number;
  expiresAt: Date;
  id: string;
  identitySessionId: string;
  invalidatedAt: Date | null;
  userId: string;
};

const passkeySelect = {
  id: true,
  displayName: true,
  transports: true,
  deviceType: true,
  backedUp: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class PrismaPasskeyEnrollmentRepository implements PasskeyEnrollmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getReauthenticationMaterial(
    userId: string,
    identitySessionId: string,
  ): Promise<PasskeyReauthenticationMaterial | null> {
    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          passwordHash: true,
          credentialVersion: true,
          authenticationPolicyVersion: true,
          status: true,
          deletedAt: true,
        },
      }),
      this.prisma.identitySession.findUnique({
        where: { id: identitySessionId },
        select: { userId: true, credentialVersion: true, authenticationPolicyVersion: true, activatedAt: true, revokedAt: true, expiresAt: true },
      }),
    ]);
    if (
      user === null ||
      session === null ||
      session.userId !== user.id ||
      session.activatedAt === null ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      session.credentialVersion !== user.credentialVersion ||
      session.authenticationPolicyVersion !== user.authenticationPolicyVersion
    ) {
      return null;
    }
    return {
      userId: user.id,
      passwordHash: user.passwordHash,
      credentialVersion: user.credentialVersion,
      status: user.status,
      deletedAt: user.deletedAt,
    };
  }

  async beginRegistration(input: {
    challengeHash: string;
    expectedCredentialVersion: number;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyRegistrationContext> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await this.lockUser(transaction, input.userId);
        const session = await this.lockSession(transaction, input.identitySessionId);
        this.assertCurrentUserSession(user, session, input.userId, input.expectedCredentialVersion, new Date());

        const now = new Date();
        await transaction.webAuthnRegistrationChallenge.updateMany({
          where: {
            userId: user.id,
            identitySessionId: session.id,
            consumedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        await transaction.webAuthnRegistrationChallenge.create({
          data: {
            userId: user.id,
            identitySessionId: session.id,
            challengeHash: input.challengeHash,
            credentialVersionSnapshot: user.credentialVersion,
            expiresAt: new Date(now.getTime() + PASSKEY_REGISTRATION_TTL_MS),
          },
        });
        const activeCredentials = await transaction.webAuthnCredential.findMany({
          where: { userId: user.id, revokedAt: null },
          select: { credentialId: true, transports: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        return {
          email: user.email,
          displayName: user.displayName,
          activeCredentials: activeCredentials.map((credential) => ({
            credentialId: credential.credentialId,
            transports: [...credential.transports],
          })),
        };
      });
    } catch (error: unknown) {
      if (this.isPrismaError(error, "P2002")) {
        throw new PasskeyConflictError("Passkey registration is already in progress.");
      }
      throw error;
    }
  }

  async claimRegistrationChallenge(input: {
    challengeHash: string;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyChallengeClaim> {
    const reference = await this.prisma.webAuthnRegistrationChallenge.findUnique({
      where: { challengeHash: input.challengeHash },
      select: { id: true },
    });
    if (reference === null) throw this.invalidCeremony();

    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, input.userId);
      const session = await this.lockSession(transaction, input.identitySessionId);
      const challenge = await this.lockChallenge(transaction, reference.id);
      const now = new Date();
      this.assertCurrentUserSession(user, session, input.userId, challenge.credentialVersionSnapshot, now);
      if (
        challenge.userId !== user.id ||
        challenge.identitySessionId !== session.id ||
        challenge.challengeHash !== input.challengeHash ||
        challenge.consumedAt !== null ||
        challenge.invalidatedAt !== null ||
        challenge.expiresAt <= now
      ) {
        throw this.invalidCeremony();
      }

      // A response gets exactly one cryptographic verification attempt. This
      // commit intentionally precedes verification so invalid signed payloads
      // cannot be replayed; credential and audit writes remain atomic later.
      await transaction.webAuthnRegistrationChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      return { challengeId: challenge.id };
    });
  }

  async completeRegistration(input: {
    challengeId: string;
    credential: VerifiedPasskeyCredential;
    identitySessionId: string;
    userId: string;
  }): Promise<PasskeyView> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await this.lockUser(transaction, input.userId);
        const session = await this.lockSession(transaction, input.identitySessionId);
        const challenge = await this.lockChallenge(transaction, input.challengeId);
        const now = new Date();
        this.assertCurrentUserSession(user, session, input.userId, challenge.credentialVersionSnapshot, now);
        if (
          challenge.userId !== user.id ||
          challenge.identitySessionId !== session.id ||
          challenge.consumedAt === null ||
          challenge.invalidatedAt !== null ||
          challenge.expiresAt <= now
        ) {
          throw this.invalidCeremony();
        }

        const credential = await transaction.webAuthnCredential.create({
          data: {
            userId: user.id,
            credentialId: input.credential.credentialId,
            publicKey: Buffer.from(input.credential.publicKey),
            counter: input.credential.counter,
            transports: input.credential.transports,
            deviceType: input.credential.deviceType,
            backedUp: input.credential.backedUp,
          },
          select: passkeySelect,
        });
        await transaction.identityAuditLog.create({
          data: {
            action: "PASSKEY_REGISTERED",
            actorUserId: user.id,
            targetUserId: user.id,
            afterState: { passkeyId: credential.id },
          },
        });
        await transaction.notificationOutbox.create({
          data: {
            kind: "PASSKEY_REGISTERED",
            userId: user.id,
            destinationAddress: user.email,
            emailVersionSnapshot: user.emailVerificationVersion,
          },
        });
        return this.toPasskeyView(credential);
      });
    } catch (error: unknown) {
      if (this.isPrismaError(error, "P2002")) {
        throw new PasskeyConflictError("This passkey is already registered.");
      }
      throw error;
    }
  }

  async listPasskeys(userId: string): Promise<PasskeyView[]> {
    const passkeys = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: passkeySelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return passkeys.map((passkey) => this.toPasskeyView(passkey));
  }

  async renamePasskey(input: {
    displayName: string;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await this.lockUser(transaction, input.userId);
      const session = await this.lockSession(transaction, input.identitySessionId);
      this.assertCurrentUserSession(user, session, input.userId, user.credentialVersion, new Date());
      const passkey = await transaction.webAuthnCredential.findFirst({
        where: { id: input.passkeyId, userId: user.id },
        select: { id: true, displayName: true },
      });
      if (passkey === null) throw new PasskeyNotFoundError("Passkey was not found.");
      const updated = await transaction.webAuthnCredential.update({
        where: { id: passkey.id },
        data: { displayName: input.displayName },
        select: passkeySelect,
      });
      await transaction.identityAuditLog.create({
        data: {
          action: "PASSKEY_RENAMED",
          actorUserId: user.id,
          targetUserId: user.id,
          beforeState: { passkeyId: passkey.id, displayName: passkey.displayName },
          afterState: { passkeyId: updated.id, displayName: updated.displayName },
        },
      });
      return this.toPasskeyView(updated);
    });
  }

  async revokePasskey(input: {
    expectedCredentialVersion: number;
    identitySessionId: string;
    passkeyId: string;
    userId: string;
  }): Promise<PasskeyView> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await this.lockUser(transaction, input.userId);
        const session = await this.lockSession(transaction, input.identitySessionId);
        this.assertCurrentUserSession(user, session, input.userId, input.expectedCredentialVersion, new Date());
        const passkey = await transaction.webAuthnCredential.findFirst({
          where: { id: input.passkeyId, userId: user.id },
          select: { id: true, revokedAt: true },
        });
        if (passkey === null) throw new PasskeyNotFoundError("Passkey was not found.");
        if (passkey.revokedAt !== null) throw new PasskeyConflictError("Passkey is already revoked.");
        const now = new Date();
        const updated = await transaction.webAuthnCredential.update({
          where: { id: passkey.id },
          data: { revokedAt: now },
          select: passkeySelect,
        });
        await transaction.identityAuditLog.create({
          data: {
            action: "PASSKEY_REVOKED",
            actorUserId: user.id,
            targetUserId: user.id,
            beforeState: { passkeyId: passkey.id, revokedAt: null },
            afterState: { passkeyId: updated.id, revokedAt: now.toISOString() },
          },
        });
        return this.toPasskeyView(updated);
      });
    } catch (error: unknown) {
      if (this.isPrismaError(error, "P0001")) {
        throw new PasskeyConflictError("The final active passkey cannot be revoked while passkey MFA is enabled.");
      }
      throw error;
    }
  }

  private async lockUser(transaction: TransactionClient, userId: string): Promise<LockedUser> {
    const users = await transaction.$queryRaw<LockedUser[]>(Prisma.sql`
      SELECT "id", "email", "displayName", "credentialVersion", "authenticationPolicyVersion", "emailVerificationVersion", "status", "deletedAt"
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

  private async lockChallenge(transaction: TransactionClient, challengeId: string): Promise<LockedChallenge> {
    const challenges = await transaction.$queryRaw<LockedChallenge[]>(Prisma.sql`
      SELECT
        "id", "userId", "identitySessionId", "challengeHash", "credentialVersionSnapshot",
        "expiresAt", "consumedAt", "invalidatedAt"
      FROM "WebAuthnRegistrationChallenge"
      WHERE "id" = ${challengeId}
      FOR UPDATE
    `);
    const challenge = challenges[0] ?? null;
    if (challenge === null) throw this.invalidCeremony();
    return challenge;
  }

  private assertCurrentUserSession(
    user: LockedUser,
    session: LockedSession,
    userId: string,
    expectedCredentialVersion: number,
    now: Date,
  ): void {
    if (
      user.id !== userId ||
      user.status !== "ACTIVE" ||
      user.deletedAt !== null ||
      user.credentialVersion !== expectedCredentialVersion ||
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

  private toPasskeyView(passkey: {
    id: string;
    displayName: string | null;
    transports: string[];
    deviceType: string | null;
    backedUp: boolean | null;
    createdAt: Date;
    updatedAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }): PasskeyView {
    return {
      id: passkey.id,
      displayName: passkey.displayName,
      transports: [...passkey.transports],
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
      updatedAt: passkey.updatedAt,
      lastUsedAt: passkey.lastUsedAt,
      revokedAt: passkey.revokedAt,
    };
  }

  private invalidCeremony(): PasskeyCeremonyInvalidError {
    return new PasskeyCeremonyInvalidError("Passkey registration is invalid or expired.");
  }

  private isPrismaError(error: unknown, code: string): error is { code: string } {
    return typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === code;
  }
}
