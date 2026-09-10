CREATE TYPE "ProductSupplyRelationshipStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "ProductSupplyRelationship" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "ProductSupplyRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplyRelationship_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSupplyRelationship_version_positive_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ProductSupplyRelationship_productId_supplierId_key"
ON "ProductSupplyRelationship"("productId", "supplierId");

CREATE INDEX "ProductSupplyRelationship_productId_status_idx"
ON "ProductSupplyRelationship"("productId", "status");

CREATE INDEX "ProductSupplyRelationship_supplierId_status_idx"
ON "ProductSupplyRelationship"("supplierId", "status");

ALTER TABLE "ProductSupplyRelationship"
ADD CONSTRAINT "ProductSupplyRelationship_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSupplyRelationship"
ADD CONSTRAINT "ProductSupplyRelationship_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
