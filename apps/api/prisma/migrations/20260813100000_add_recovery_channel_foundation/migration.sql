-- Recovery channel foundation. Existing email addresses deliberately start
-- unverified: an account identifier alone is never treated as a recovery
-- channel that the account holder has proven they control.

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'EMAIL_VERIFICATION_REQUESTED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'EMAIL_VERIFIED';

-- CreateEnum
CREATE TYPE "NotificationOutboxKind" AS ENUM ('EMAIL_VERIFICATION');
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD', 'CANCELLED');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "IdentityAuditLog" ALTER COLUMN "actorUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "emailVersionSnapshot" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "kind" "NotificationOutboxKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "destinationAddress" TEXT,
    "emailVersionSnapshot" INTEGER NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "claimedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "terminalAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_emailVersionSnapshot_idx" ON "EmailVerificationToken"("userId", "emailVersionSnapshot");
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");
CREATE INDEX "NotificationOutbox_userId_createdAt_idx" ON "NotificationOutbox"("userId", "createdAt");
CREATE INDEX "NotificationOutbox_leaseUntil_idx" ON "NotificationOutbox"("leaseUntil");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New users must start with an unverified mailbox. Email changes clear the
-- verification marker and advance a generation counter, so a token delivered
-- to an old address can never verify a new address. The counter cannot be
-- changed independently of the address.
CREATE FUNCTION "enforce_user_email_verification_version"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."emailVerifiedAt" IS NOT NULL OR NEW."emailVerificationVersion" <> 1 THEN
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

CREATE TRIGGER "User_enforce_email_verification_version"
BEFORE INSERT OR UPDATE OF "email", "emailVerifiedAt", "emailVerificationVersion" ON "User"
FOR EACH ROW
EXECUTE FUNCTION "enforce_user_email_verification_version"();
