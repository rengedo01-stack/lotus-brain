-- A newly issued session cookie is deliberately non-authenticating until its
-- response-bound proof activates it. Existing sessions remain authenticated:
-- their historical creation moment is their activation moment.
ALTER TABLE "IdentitySession" ADD COLUMN "activatedAt" TIMESTAMP(3);

UPDATE "IdentitySession"
SET "activatedAt" = "createdAt"
WHERE "activatedAt" IS NULL;
