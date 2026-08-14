-- Password + UV-required WebAuthn MFA. This migration is deliberately
-- forward-only: existing users remain MFA-disabled and existing sessions are
-- backfilled from the user's initial authentication policy generation.

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEY_MFA_ENABLED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEY_MFA_DISABLED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSKEYS_RESET_BY_RECOVERY';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'PASSKEY_REGISTERED';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'PASSKEY_MFA_ENABLED';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'PASSKEY_MFA_DISABLED';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'AUTHENTICATORS_RESET_BY_RECOVERY';
CREATE TYPE "WebAuthnStepUpPurpose" AS ENUM ('ENABLE_MFA', 'DISABLE_MFA');

-- Existing users and sessions deliberately start on generation 1.  The
-- default-add/backfill sequence avoids logging out existing users.
ALTER TABLE "User"
  ADD COLUMN "authenticationPolicyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "passkeyMfaEnabledAt" TIMESTAMP(3);
ALTER TABLE "IdentitySession" ADD COLUMN "authenticationPolicyVersion" INTEGER NOT NULL DEFAULT 1;
UPDATE "IdentitySession" AS "session"
SET "authenticationPolicyVersion" = "user"."authenticationPolicyVersion"
FROM "User" AS "user"
WHERE "session"."userId" = "user"."id";

-- A server-side, hash-only challenge is used for the authenticated enable and
-- disable ceremonies.  Login pre-authentication has its own opaque token and
-- challenge so it can never be accepted by SessionAuthGuard.
CREATE TABLE "WebAuthnStepUpChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "identitySessionId" TEXT NOT NULL,
  "purpose" "WebAuthnStepUpPurpose" NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "credentialVersionSnapshot" INTEGER NOT NULL,
  "authenticationPolicyVersionSnapshot" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebAuthnStepUpChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebAuthnStepUpChallenge_terminal_state"
    CHECK ("consumedAt" IS NULL OR "invalidatedAt" IS NULL)
);

CREATE TABLE "PasskeyMfaLoginTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transactionTokenHash" TEXT NOT NULL,
  "csrfTokenHash" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "credentialVersionSnapshot" INTEGER NOT NULL,
  "authenticationPolicyVersionSnapshot" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasskeyMfaLoginTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnStepUpChallenge_challengeHash_key"
  ON "WebAuthnStepUpChallenge"("challengeHash");
CREATE INDEX "WebAuthnStepUpChallenge_userId_identitySessionId_expiresAt_idx"
  ON "WebAuthnStepUpChallenge"("userId", "identitySessionId", "expiresAt");
CREATE INDEX "WebAuthnStepUpChallenge_expiresAt_idx" ON "WebAuthnStepUpChallenge"("expiresAt");
CREATE UNIQUE INDEX "WebAuthnStepUpChallenge_one_active_per_session_and_purpose"
  ON "WebAuthnStepUpChallenge"("userId", "identitySessionId", "purpose")
  WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;
CREATE UNIQUE INDEX "PasskeyMfaLoginTransaction_transactionTokenHash_key"
  ON "PasskeyMfaLoginTransaction"("transactionTokenHash");
CREATE UNIQUE INDEX "PasskeyMfaLoginTransaction_csrfTokenHash_key"
  ON "PasskeyMfaLoginTransaction"("csrfTokenHash");
CREATE UNIQUE INDEX "PasskeyMfaLoginTransaction_challengeHash_key"
  ON "PasskeyMfaLoginTransaction"("challengeHash");
CREATE INDEX "PasskeyMfaLoginTransaction_userId_expiresAt_idx"
  ON "PasskeyMfaLoginTransaction"("userId", "expiresAt");
CREATE INDEX "PasskeyMfaLoginTransaction_expiresAt_idx" ON "PasskeyMfaLoginTransaction"("expiresAt");

ALTER TABLE "WebAuthnStepUpChallenge" ADD CONSTRAINT "WebAuthnStepUpChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebAuthnStepUpChallenge" ADD CONSTRAINT "WebAuthnStepUpChallenge_identitySessionId_fkey"
  FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasskeyMfaLoginTransaction" ADD CONSTRAINT "PasskeyMfaLoginTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-enforced policy semantics.  Application code may only change the
-- policy generation as part of a state transition; a normal User update
-- cannot accidentally resurrect a stale session.
CREATE OR REPLACE FUNCTION "enforce_user_authentication_policy"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."authenticationPolicyVersion" < 1 THEN
    RAISE EXCEPTION 'authenticationPolicyVersion must be positive';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."passkeyMfaEnabledAt" IS DISTINCT FROM OLD."passkeyMfaEnabledAt" THEN
      IF NEW."authenticationPolicyVersion" <> OLD."authenticationPolicyVersion" + 1 THEN
        RAISE EXCEPTION 'authenticationPolicyVersion must increment exactly once when MFA policy changes';
      END IF;
    ELSIF NEW."authenticationPolicyVersion" IS DISTINCT FROM OLD."authenticationPolicyVersion" THEN
      RAISE EXCEPTION 'authenticationPolicyVersion may change only with an MFA policy transition';
    END IF;
  END IF;

  IF NEW."passkeyMfaEnabledAt" IS NOT NULL AND NEW."emailVerifiedAt" IS NULL THEN
    RAISE EXCEPTION 'passkey MFA requires a verified recovery email';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_enforce_authentication_policy"
BEFORE INSERT OR UPDATE OF "passkeyMfaEnabledAt", "authenticationPolicyVersion", "emailVerifiedAt" ON "User"
FOR EACH ROW EXECUTE FUNCTION "enforce_user_authentication_policy"();

CREATE OR REPLACE FUNCTION "enforce_mfa_active_passkey"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."passkeyMfaEnabledAt" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "WebAuthnCredential"
    WHERE "userId" = NEW."id" AND "revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'passkey MFA requires an active passkey';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_enforce_mfa_active_passkey"
AFTER INSERT OR UPDATE OF "passkeyMfaEnabledAt" ON "User"
FOR EACH ROW EXECUTE FUNCTION "enforce_mfa_active_passkey"();

CREATE OR REPLACE FUNCTION "prevent_last_mfa_passkey_revoke"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."revokedAt" IS NOT NULL AND OLD."revokedAt" IS NULL THEN
    -- User -> credential is the repository lock order.  Taking this lock here
    -- serializes direct SQL updates as well as concurrent application revokes.
    PERFORM 1 FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM "User"
      WHERE "id" = NEW."userId" AND "passkeyMfaEnabledAt" IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM "WebAuthnCredential"
      WHERE "userId" = NEW."userId" AND "revokedAt" IS NULL AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'cannot revoke the final active passkey while MFA is enabled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WebAuthnCredential_prevent_last_mfa_revoke"
BEFORE UPDATE OF "revokedAt" ON "WebAuthnCredential"
FOR EACH ROW EXECUTE FUNCTION "prevent_last_mfa_passkey_revoke"();

-- Keep actor attribution precise for self-service MFA changes while allowing
-- recovery to remain actorless, just like PASSWORD_RESET_COMPLETED.
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
      "action"::TEXT IN (
        'PASSKEY_REGISTERED', 'PASSKEY_RENAMED', 'PASSKEY_REVOKED',
        'PASSKEY_MFA_ENABLED', 'PASSKEY_MFA_DISABLED'
      )
      AND "targetUserId" IS NOT NULL
      AND "actorUserId" IS NOT NULL
      AND "actorUserId" = "targetUserId"
    )
    OR
    (
      "action"::TEXT = 'PASSKEYS_RESET_BY_RECOVERY'
      AND "targetUserId" IS NOT NULL
      AND "actorUserId" IS NULL
    )
    OR
    (
      "action"::TEXT NOT IN (
        'USER_INVITATION_CREATED', 'USER_INVITATION_RESENT', 'USER_INVITATION_CANCELLED',
        'USER_INVITATION_ACCEPTED',
        'PASSKEY_REGISTERED', 'PASSKEY_RENAMED', 'PASSKEY_REVOKED',
        'PASSKEY_MFA_ENABLED', 'PASSKEY_MFA_DISABLED', 'PASSKEYS_RESET_BY_RECOVERY'
      )
      AND "targetUserId" IS NOT NULL
    )
  );
