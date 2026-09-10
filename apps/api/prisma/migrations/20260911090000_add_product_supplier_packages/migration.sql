CREATE TYPE "ProductSupplierPackageStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "ProductSupplierPackage" (
  "id" TEXT NOT NULL,
  "relationshipId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "inventoryQuantityPerPackage" DECIMAL(24,9) NOT NULL,
  "isOrderable" BOOLEAN NOT NULL DEFAULT false,
  "status" "ProductSupplierPackageStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductSupplierPackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSupplierPackage_version_positive_check" CHECK ("version" > 0),
  CONSTRAINT "ProductSupplierPackage_inventory_quantity_positive_check" CHECK ("inventoryQuantityPerPackage" > 0)
);

CREATE UNIQUE INDEX "ProductSupplierPackage_relationshipId_code_key"
  ON "ProductSupplierPackage"("relationshipId", "code");

CREATE INDEX "ProductSupplierPackage_relationshipId_status_idx"
  ON "ProductSupplierPackage"("relationshipId", "status");

ALTER TABLE "ProductSupplierPackage"
  ADD CONSTRAINT "ProductSupplierPackage_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "ProductSupplyRelationship"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
