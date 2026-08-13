-- Passkey enrollment lifecycle. WebAuthn registration does not alter password
-- authentication; it persists only public credentials and one-time challenge digests.

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEY_REGISTERED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEY_RENAMED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEY_REVOKED';

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[] NOT NULL,
    "deviceType" TEXT,
    "backedUp" BOOLEAN,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebAuthnCredential_counter_nonnegative" CHECK ("counter" >= 0)
);

CREATE TABLE "WebAuthnRegistrationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identitySessionId" TEXT NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "credentialVersionSnapshot" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnRegistrationChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WebAuthnRegistrationChallenge_terminal_state"
      CHECK ("consumedAt" IS NULL OR "invalidatedAt" IS NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");
CREATE INDEX "WebAuthnCredential_userId_createdAt_idx" ON "WebAuthnCredential"("userId", "createdAt");
CREATE INDEX "WebAuthnCredential_userId_revokedAt_idx" ON "WebAuthnCredential"("userId", "revokedAt");
CREATE UNIQUE INDEX "WebAuthnRegistrationChallenge_challengeHash_key" ON "WebAuthnRegistrationChallenge"("challengeHash");
CREATE INDEX "WebAuthnRegistrationChallenge_userId_identitySessionId_expiresAt_idx"
  ON "WebAuthnRegistrationChallenge"("userId", "identitySessionId", "expiresAt");
CREATE INDEX "WebAuthnRegistrationChallenge_expiresAt_idx" ON "WebAuthnRegistrationChallenge"("expiresAt");
CREATE UNIQUE INDEX "WebAuthnRegistrationChallenge_one_active_per_session"
  ON "WebAuthnRegistrationChallenge"("userId", "identitySessionId")
  WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebAuthnRegistrationChallenge" ADD CONSTRAINT "WebAuthnRegistrationChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebAuthnRegistrationChallenge" ADD CONSTRAINT "WebAuthnRegistrationChallenge_identitySessionId_fkey"
  FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Public invitation acceptance remains actorless. Passkey administration is
-- self-service and must retain the authenticated current user as both actor
-- and target, without storing ceremony material in the audit record.
ALTER TABLE "IdentityAuditLog" DROP CONSTRAINT "IdentityAuditLog_target_by_action";
ALTER TABLE "IdentityAuditLog" ADD CONSTRAINT "IdentityAuditLog_target_by_action"
  CHECK (
    (
      "action"::TEXT IN ('USER_INVITATION_CREATED', 'USER_INVITATION_RESENT', 'USER_INVITATION_CANCELLED')
      AND "targetUserId" IS NULL
      AND "actorUserId" IS NOT NULL
    )
    OR
    (
      "action"::TEXT = 'USER_INVITATION_ACCEPTED'
      AND "targetUserId" IS NOT NULL
      AND "actorUserId" IS NULL
    )
    OR
    (
      "action"::TEXT IN ('PASSKEY_REGISTERED', 'PASSKEY_RENAMED', 'PASSKEY_REVOKED')
      AND "targetUserId" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "actorUserId" = "targetUserId"
    )
    OR
    (
      "action"::TEXT NOT IN (
        'USER_INVITATION_CREATED',
        'USER_INVITATION_RESENT',
        'USER_INVITATION_CANCELLED',
        'USER_INVITATION_ACCEPTED',
        'PASSKEY_REGISTERED',
        'PASSKEY_RENAMED',
        'PASSKEY_REVOKED'
      )
      AND "targetUserId" IS NOT NULL
    )
  );
