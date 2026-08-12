-- Authorization administration is deliberately limited to custom roles. The
-- existing system roles remain immutable rollout and break-glass primitives.

-- AlterEnum
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'CREATE_CUSTOM_ROLE';
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'UPDATE_CUSTOM_ROLE';
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'GRANT_ROLE_PERMISSION';
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'REVOKE_ROLE_PERMISSION';
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'GRANT_USER_ROLE';
ALTER TYPE "AuthorizationAuditAction" ADD VALUE 'REVOKE_USER_ROLE';
ALTER TYPE "AuthorizationAuditSource" ADD VALUE 'AUTHORIZATION_API';

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Role" ADD COLUMN "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE';

-- Existing roles, including the two system roles, are active at rollout.
UPDATE "Role" SET "status" = 'ACTIVE' WHERE "status" IS NULL;

-- Extend the focused authorization audit log without creating a generic audit
-- facility. Existing CLI grant records retain their target and role fields.
ALTER TABLE "AuthorizationAuditLog"
  ALTER COLUMN "targetUserId" DROP NOT NULL,
  ALTER COLUMN "roleId" DROP NOT NULL,
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "permissionId" TEXT,
  ADD COLUMN "beforeState" JSONB,
  ADD COLUMN "afterState" JSONB;

-- CreateIndex
CREATE INDEX "AuthorizationAuditLog_actorUserId_createdAt_idx" ON "AuthorizationAuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuthorizationAuditLog_permissionId_idx" ON "AuthorizationAuditLog"("permissionId");

-- AddForeignKey
ALTER TABLE "AuthorizationAuditLog" ADD CONSTRAINT "AuthorizationAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthorizationAuditLog" ADD CONSTRAINT "AuthorizationAuditLog_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend the application-owned registry snapshot. LEGACY_AUTHENTICATED must
-- retain exactly the rollout business permissions and receives neither entry.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-authorization-read', 'authorization.read', 'Read authorization configuration.'),
  ('rbac-permission-authorization-manage', 'authorization.manage', 'Manage custom authorization policy.')
ON CONFLICT ("code") DO NOTHING;

-- Only the break-glass system administrator receives the administration
-- permissions. No user is assigned SYSTEM_ADMIN by this migration.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
JOIN "Permission" ON "Permission"."code" IN ('authorization.read', 'authorization.manage')
WHERE "Role"."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Role code and system classification are immutable for every role. System
-- roles additionally cannot be disabled or deleted.
DROP TRIGGER IF EXISTS "Role_prevent_system_identity_mutation" ON "Role";
CREATE OR REPLACE FUNCTION "prevent_system_role_identity_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."isSystem" AND NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'System roles must remain active.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."isSystem" THEN
      RAISE EXCEPTION 'System roles cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'Role code is immutable.';
  END IF;

  IF NEW."isSystem" IS DISTINCT FROM OLD."isSystem" THEN
    RAISE EXCEPTION 'Role system classification is immutable.';
  END IF;

  IF OLD."isSystem" AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'System roles cannot be disabled.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Role_prevent_system_identity_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "Role"
FOR EACH ROW
EXECUTE FUNCTION "prevent_system_role_identity_mutation"();

-- authorization.manage is intentionally non-delegable in this release. This
-- database invariant protects the rule even if an application path is added
-- incorrectly in the future.
CREATE FUNCTION "prevent_authorization_manage_delegation"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Role" AS "role"
    JOIN "Permission" AS "permission" ON "permission"."id" = NEW."permissionId"
    WHERE "role"."id" = NEW."roleId"
      AND "permission"."code" = 'authorization.manage'
      AND "role"."code" <> 'SYSTEM_ADMIN'
  ) THEN
    RAISE EXCEPTION 'authorization.manage can only be assigned to SYSTEM_ADMIN.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RolePermission_prevent_authorization_manage_delegation"
BEFORE INSERT OR UPDATE OF "roleId", "permissionId" ON "RolePermission"
FOR EACH ROW
EXECUTE FUNCTION "prevent_authorization_manage_delegation"();
