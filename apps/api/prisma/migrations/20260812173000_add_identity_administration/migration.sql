-- Identity administration is deliberately limited to directory reads and
-- lifecycle changes. User creation, restoration, credentials, and role
-- assignment remain outside this bounded context.

-- CreateEnum
CREATE TYPE "IdentityAuditAction" AS ENUM ('UPDATE_USER_STATUS', 'SOFT_DELETE_USER');

-- CreateTable
CREATE TABLE "IdentityAuditLog" (
    "id" TEXT NOT NULL,
    "action" "IdentityAuditAction" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdentityAuditLog_actorUserId_createdAt_idx" ON "IdentityAuditLog"("actorUserId", "createdAt");
CREATE INDEX "IdentityAuditLog_targetUserId_createdAt_idx" ON "IdentityAuditLog"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "IdentityAuditLog" ADD CONSTRAINT "IdentityAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityAuditLog" ADD CONSTRAINT "IdentityAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend the application-owned permission registry snapshot. Only the
-- break-glass SYSTEM_ADMIN role receives lifecycle management. Legacy users
-- retain their existing business permissions and receive neither entry.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-identity-read', 'identity.read', 'Read user identity directory and lifecycle state.'),
  ('rbac-permission-identity-manage', 'identity.manage', 'Manage user identity lifecycle.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
JOIN "Permission" ON "Permission"."code" IN ('identity.read', 'identity.manage')
WHERE "Role"."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Replace the PR-004E single-permission invariant with one canonical
-- SYSTEM_ADMIN-only invariant for every non-delegable administration
-- permission. This closes raw inserts and updates as well as API paths.
DROP TRIGGER IF EXISTS "RolePermission_prevent_authorization_manage_delegation" ON "RolePermission";
DROP FUNCTION IF EXISTS "prevent_authorization_manage_delegation"();

CREATE FUNCTION "prevent_system_admin_only_permission_delegation"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Role" AS "role"
    JOIN "Permission" AS "permission" ON "permission"."id" = NEW."permissionId"
    WHERE "role"."id" = NEW."roleId"
      AND "permission"."code" IN ('authorization.manage', 'identity.manage')
      AND "role"."code" <> 'SYSTEM_ADMIN'
  ) THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN-only permissions cannot be assigned to another role.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RolePermission_prevent_system_admin_only_permission_delegation"
BEFORE INSERT OR UPDATE OF "roleId", "permissionId" ON "RolePermission"
FOR EACH ROW
EXECUTE FUNCTION "prevent_system_admin_only_permission_delegation"();

-- A SYSTEM_ADMIN assignment and an identity lifecycle mutation serialize on
-- the User row. This trigger is defense in depth for direct SQL updates after
-- an administrator has been assigned.
CREATE FUNCTION "prevent_system_admin_user_lifecycle_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW."status" <> 'ACTIVE' OR NEW."deletedAt" IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM "UserRole"
      JOIN "Role" ON "Role"."id" = "UserRole"."roleId"
      WHERE "UserRole"."userId" = OLD."id"
        AND "Role"."code" = 'SYSTEM_ADMIN'
    ) THEN
    RAISE EXCEPTION 'SYSTEM_ADMIN users cannot be disabled, locked, or soft-deleted.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_prevent_system_admin_lifecycle_mutation"
BEFORE UPDATE OF "status", "deletedAt" ON "User"
FOR EACH ROW
EXECUTE FUNCTION "prevent_system_admin_user_lifecycle_mutation"();

-- Direct SYSTEM_ADMIN grants lock and re-check the User row. Together with
-- the lifecycle trigger and application row locks, this prevents a grant from
-- racing a disable/lock/soft-delete into an unsafe committed state.
CREATE FUNCTION "prevent_system_admin_assignment_to_ineligible_user"()
RETURNS TRIGGER AS $$
DECLARE
  target_status "UserStatus";
  target_deleted_at TIMESTAMP(3);
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Role"
    WHERE "id" = NEW."roleId" AND "code" = 'SYSTEM_ADMIN'
  ) THEN
    SELECT "status", "deletedAt"
    INTO target_status, target_deleted_at
    FROM "User"
    WHERE "id" = NEW."userId"
    FOR UPDATE;

    IF target_status IS DISTINCT FROM 'ACTIVE' OR target_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'SYSTEM_ADMIN can only be assigned to an active, non-deleted user.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UserRole_prevent_system_admin_assignment_to_ineligible_user"
BEFORE INSERT OR UPDATE OF "userId", "roleId" ON "UserRole"
FOR EACH ROW
EXECUTE FUNCTION "prevent_system_admin_assignment_to_ineligible_user"();
