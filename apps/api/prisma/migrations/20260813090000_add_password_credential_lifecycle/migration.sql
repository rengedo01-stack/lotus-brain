-- Password credential lifecycle. Existing credentials and sessions deliberately
-- start at version 1 so this forward-only migration does not force a logout.

-- AlterEnum
ALTER TYPE "IdentityAuditAction" ADD VALUE 'CHANGE_PASSWORD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "IdentitySession" ADD COLUMN "credentialVersion" INTEGER;

-- Backfill every existing session from its owning User before making the new
-- snapshot mandatory. Existing session validity otherwise remains unchanged.
UPDATE "IdentitySession" AS "session"
SET "credentialVersion" = "user"."credentialVersion"
FROM "User" AS "user"
WHERE "user"."id" = "session"."userId";

ALTER TABLE "IdentitySession" ALTER COLUMN "credentialVersion" SET NOT NULL;

-- Password hashes and credential-version changes are inseparable. This blocks
-- future direct writes that would otherwise leave existing sessions usable.
CREATE FUNCTION "enforce_user_password_credential_version"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."credentialVersion" <> 1 THEN
      RAISE EXCEPTION 'New users must start at credential version 1.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN
    IF NEW."credentialVersion" <> OLD."credentialVersion" + 1 THEN
      RAISE EXCEPTION 'A password hash change must increment credential version exactly once.';
    END IF;
  ELSIF NEW."credentialVersion" IS DISTINCT FROM OLD."credentialVersion" THEN
    RAISE EXCEPTION 'Credential version cannot change without a password hash change.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_enforce_password_credential_version"
BEFORE INSERT OR UPDATE OF "passwordHash", "credentialVersion" ON "User"
FOR EACH ROW
EXECUTE FUNCTION "enforce_user_password_credential_version"();

-- A session can only be inserted with the current credential version. The
-- row lock serializes this check with password changes: if login wins,
-- the subsequent change revokes the session; if the change wins, the stale
-- login insert is rejected.
CREATE FUNCTION "enforce_identity_session_credential_version"()
RETURNS TRIGGER AS $$
DECLARE
  current_credential_version INTEGER;
BEGIN
  SELECT "credentialVersion"
  INTO current_credential_version
  FROM "User"
  WHERE "id" = NEW."userId"
  FOR UPDATE;

  IF current_credential_version IS NULL
     OR NEW."credentialVersion" <> current_credential_version THEN
    RAISE EXCEPTION 'IdentitySession credential version must match its User.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "IdentitySession_enforce_credential_version"
BEFORE INSERT OR UPDATE OF "userId", "credentialVersion" ON "IdentitySession"
FOR EACH ROW
EXECUTE FUNCTION "enforce_identity_session_credential_version"();
