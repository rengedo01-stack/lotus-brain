-- User invitation lifecycle. An invitation is deliberately not a User or an
-- authentication principal until the invited mailbox accepts its credential.

-- CreateEnum
CREATE TYPE "UserInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'USER_INVITATION_CREATED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'USER_INVITATION_RESENT';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'USER_INVITATION_CANCELLED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'USER_INVITATION_ACCEPTED';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'USER_INVITATION';

-- AlterTable
ALTER TABLE "IdentityAuditLog" ALTER COLUMN "targetUserId" DROP NOT NULL;
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
      "action"::TEXT NOT IN (
        'USER_INVITATION_CREATED',
        'USER_INVITATION_RESENT',
        'USER_INVITATION_CANCELLED',
        'USER_INVITATION_ACCEPTED'
      )
      AND "targetUserId" IS NOT NULL
    )
  );
ALTER TABLE "NotificationOutbox" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "NotificationOutbox" ALTER COLUMN "emailVersionSnapshot" DROP NOT NULL;
ALTER TABLE "NotificationOutbox" ADD COLUMN "invitationId" TEXT;

-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "UserInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserInvitationToken" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInvitationToken_pkey" PRIMARY KEY ("id")
);

-- Lifecycle timestamps cannot describe more than one terminal state, and a
-- credential cannot be both consumed and invalidated.
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_state_timestamps"
  CHECK (
    ("status"::TEXT = 'PENDING' AND "acceptedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status"::TEXT = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status"::TEXT = 'CANCELLED' AND "acceptedAt" IS NULL AND "cancelledAt" IS NOT NULL)
  );
ALTER TABLE "UserInvitationToken" ADD CONSTRAINT "UserInvitationToken_terminal_state"
  CHECK ("consumedAt" IS NULL OR "invalidatedAt" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_pending_email_key"
  ON "UserInvitation"("email")
  WHERE "status" = 'PENDING';
CREATE INDEX "UserInvitation_status_createdAt_idx" ON "UserInvitation"("status", "createdAt");
CREATE INDEX "UserInvitation_createdByUserId_createdAt_idx" ON "UserInvitation"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "UserInvitationToken_tokenHash_key" ON "UserInvitationToken"("tokenHash");
CREATE INDEX "UserInvitationToken_invitationId_expiresAt_idx" ON "UserInvitationToken"("invitationId", "expiresAt");
CREATE INDEX "UserInvitationToken_expiresAt_idx" ON "UserInvitationToken"("expiresAt");
CREATE INDEX "NotificationOutbox_invitationId_createdAt_idx" ON "NotificationOutbox"("invitationId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserInvitationToken" ADD CONSTRAINT "UserInvitationToken_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "UserInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "UserInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every notification belongs to exactly one supported principal. Existing
-- user-owned notification kinds retain their required user and email snapshot;
-- invitations are immutable-email credentials and therefore have no User
-- email-generation snapshot before acceptance.
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_owner_by_kind"
  CHECK (
    (
      "kind"::TEXT = 'USER_INVITATION'
      AND "invitationId" IS NOT NULL
      AND "userId" IS NULL
      AND "emailVersionSnapshot" IS NULL
    )
    OR
    (
      "kind"::TEXT <> 'USER_INVITATION'
      AND "userId" IS NOT NULL
      AND "invitationId" IS NULL
      AND "emailVersionSnapshot" IS NOT NULL
    )
  );

-- An accepted invitation is the sole onboarding path that creates an already
-- verified mailbox. The invitation, consumed credential, and User insert are
-- committed in one transaction by the application; the trigger retains the
-- prior invariant for every other User insert and all email changes.
CREATE OR REPLACE FUNCTION "enforce_user_email_verification_version"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."emailVerificationVersion" <> 1 THEN
      RAISE EXCEPTION 'New users must start at email verification version 1.';
    END IF;
    IF NEW."emailVerifiedAt" IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM "UserInvitation" AS "invitation"
      INNER JOIN "UserInvitationToken" AS "token"
        ON "token"."invitationId" = "invitation"."id"
      WHERE "invitation"."email" = NEW."email"
        AND "invitation"."status" = 'ACCEPTED'
        AND "invitation"."acceptedAt" IS NOT NULL
        AND "token"."consumedAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'New users must start with an unverified email at version 1.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."email" IS DISTINCT FROM OLD."email" THEN
    IF NEW."emailVerifiedAt" IS NOT NULL
       OR NEW."emailVerificationVersion" <> OLD."emailVerificationVersion" + 1 THEN
      RAISE EXCEPTION 'An email change must clear verification and increment the email verification version exactly once.';
    END IF;
  ELSIF NEW."emailVerificationVersion" IS DISTINCT FROM OLD."emailVerificationVersion" THEN
    RAISE EXCEPTION 'Email verification version cannot change without an email change.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
