-- Core permission-first RBAC. These records are an immutable rollout snapshot;
-- later permissions must be added by their own forward-only migration.

-- CreateEnum
CREATE TYPE "AuthorizationAuditAction" AS ENUM ('GRANT_SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "AuthorizationAuditSource" AS ENUM ('SERVER_CLI');

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);

-- CreateTable
CREATE TABLE "AuthorizationAuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuthorizationAuditAction" NOT NULL,
    "source" "AuthorizationAuditSource" NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "AuthorizationAuditLog_targetUserId_createdAt_idx" ON "AuthorizationAuditLog"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthorizationAuditLog_roleId_idx" ON "AuthorizationAuditLog"("roleId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationAuditLog" ADD CONSTRAINT "AuthorizationAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationAuditLog" ADD CONSTRAINT "AuthorizationAuditLog_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the application-owned permission registry snapshot.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-master-read', 'master.read', 'Read master data.'),
  ('rbac-permission-master-write', 'master.write', 'Create or update master data.'),
  ('rbac-permission-purchase-read', 'purchase.read', 'Read purchases.'),
  ('rbac-permission-purchase-write', 'purchase.write', 'Create or update purchase drafts.'),
  ('rbac-permission-purchase-confirm', 'purchase.confirm', 'Confirm purchase drafts.'),
  ('rbac-permission-purchase-post', 'purchase.post', 'Post purchases.'),
  ('rbac-permission-production-post', 'production.post', 'Post productions.'),
  ('rbac-permission-stocktake-read', 'stocktake.read', 'Read stocktakes.'),
  ('rbac-permission-stocktake-write', 'stocktake.write', 'Create or update stocktake drafts.'),
  ('rbac-permission-stocktake-confirm', 'stocktake.confirm', 'Confirm stocktake drafts.'),
  ('rbac-permission-stocktake-post', 'stocktake.post', 'Post stocktakes.');

-- Seed only system roles. No organizational roles are inferred in this migration.
INSERT INTO "Role" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt") VALUES
  ('rbac-role-system-admin', 'SYSTEM_ADMIN', 'System administrator', 'System-managed role with all permissions in this migration.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rbac-role-legacy-authenticated', 'LEGACY_AUTHENTICATED', 'Legacy authenticated user', 'Compatibility role for business access that existed before RBAC.', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Both roles receive the current registry snapshot. LEGACY_AUTHENTICATED is not
-- automatically granted permissions introduced by future migrations.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
CROSS JOIN "Permission"
WHERE "Role"."code" IN ('SYSTEM_ADMIN', 'LEGACY_AUTHENTICATED');

-- Preserve business access for only users that were valid at rollout time.
-- SYSTEM_ADMIN is deliberately not assigned here.
INSERT INTO "UserRole" ("userId", "roleId")
SELECT "User"."id", "Role"."id"
FROM "User"
CROSS JOIN "Role"
WHERE "User"."status" = 'ACTIVE'
  AND "User"."deletedAt" IS NULL
  AND "Role"."code" = 'LEGACY_AUTHENTICATED'
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- System role identity is immutable even when future administration APIs exist.
CREATE FUNCTION "prevent_system_role_identity_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."isSystem" THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'System roles cannot be deleted.';
    END IF;

    IF NEW."code" IS DISTINCT FROM OLD."code"
       OR NEW."isSystem" IS DISTINCT FROM OLD."isSystem" THEN
      RAISE EXCEPTION 'System role code and system status are immutable.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Role_prevent_system_identity_mutation"
BEFORE UPDATE OF "code", "isSystem" OR DELETE ON "Role"
FOR EACH ROW
EXECUTE FUNCTION "prevent_system_role_identity_mutation"();
