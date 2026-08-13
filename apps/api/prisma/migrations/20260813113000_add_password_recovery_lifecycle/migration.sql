-- Password recovery lifecycle. Recovery credentials remain separate from
-- email-verification credentials and are bound to both credential and email
-- verification generations.

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSWORD_RECOVERY_REQUESTED';
ALTER TYPE "IdentityAuditAction" ADD VALUE 'PASSWORD_RESET_COMPLETED';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'PASSWORD_RECOVERY';
ALTER TYPE "NotificationOutboxKind" ADD VALUE 'PASSWORD_RESET_COMPLETED';

-- AlterTable
ALTER TABLE "NotificationOutbox"
  ADD COLUMN "credentialVersionSnapshot" INTEGER;

-- CreateTable
CREATE TABLE "PasswordRecoveryToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "credentialVersionSnapshot" INTEGER NOT NULL,
    "emailVerificationVersionSnapshot" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordRecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordRecoveryToken_tokenHash_key" ON "PasswordRecoveryToken"("tokenHash");
CREATE INDEX "PasswordRecoveryToken_userId_idx" ON "PasswordRecoveryToken"("userId");
CREATE INDEX "PasswordRecoveryToken_expiresAt_idx" ON "PasswordRecoveryToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordRecoveryToken" ADD CONSTRAINT "PasswordRecoveryToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
