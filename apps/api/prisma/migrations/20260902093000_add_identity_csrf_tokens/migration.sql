-- Active-session CSRF credentials are stored independently so multiple tabs
-- can retain bounded, session-scoped tokens during a rolling deployment.
CREATE TABLE "IdentityCsrfToken" (
    "id" TEXT NOT NULL,
    "identitySessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityCsrfToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityCsrfToken_tokenHash_key" ON "IdentityCsrfToken"("tokenHash");
CREATE INDEX "IdentityCsrfToken_identitySessionId_issuedAt_id_idx"
  ON "IdentityCsrfToken"("identitySessionId", "issuedAt", "id");
CREATE INDEX "IdentityCsrfToken_expiresAt_idx" ON "IdentityCsrfToken"("expiresAt");

ALTER TABLE "IdentityCsrfToken"
  ADD CONSTRAINT "IdentityCsrfToken_identitySessionId_fkey"
  FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every session that is currently active under the legacy scalar
-- model. Pending sessions intentionally receive no normal CSRF token.
INSERT INTO "IdentityCsrfToken" ("id", "identitySessionId", "tokenHash", "issuedAt", "expiresAt")
SELECT
  "id",
  "id",
  "csrfTokenHash",
  COALESCE("activatedAt", "createdAt"),
  "expiresAt"
FROM "IdentitySession"
WHERE "activatedAt" IS NOT NULL
  AND "revokedAt" IS NULL
  AND "expiresAt" > CURRENT_TIMESTAMP
ON CONFLICT ("tokenHash") DO NOTHING;
