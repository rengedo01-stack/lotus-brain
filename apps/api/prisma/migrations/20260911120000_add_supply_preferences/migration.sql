CREATE TABLE "ProductSupplyPreference" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSupplyPreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSupplyPreference_version_positive_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ProductSupplyPreference_productId_key" ON "ProductSupplyPreference"("productId");
CREATE UNIQUE INDEX "ProductSupplyPreference_relationshipId_key" ON "ProductSupplyPreference"("relationshipId");

ALTER TABLE "ProductSupplyPreference"
  ADD CONSTRAINT "ProductSupplyPreference_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSupplyPreference"
  ADD CONSTRAINT "ProductSupplyPreference_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "ProductSupplyRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProductSupplierPackagePreference" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductSupplierPackagePreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSupplierPackagePreference_version_positive_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ProductSupplierPackagePreference_relationshipId_key" ON "ProductSupplierPackagePreference"("relationshipId");
CREATE UNIQUE INDEX "ProductSupplierPackagePreference_packageId_key" ON "ProductSupplierPackagePreference"("packageId");

ALTER TABLE "ProductSupplierPackagePreference"
  ADD CONSTRAINT "ProductSupplierPackagePreference_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "ProductSupplyRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSupplierPackagePreference"
  ADD CONSTRAINT "ProductSupplierPackagePreference_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "ProductSupplierPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
