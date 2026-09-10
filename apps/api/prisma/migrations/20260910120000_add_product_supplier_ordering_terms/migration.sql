CREATE TABLE "ProductSupplierOrderingTerms" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "minimumOrderQuantity" DECIMAL(24,9),
    "orderMultipleQuantity" DECIMAL(24,9),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplierOrderingTerms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSupplierOrderingTerms_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "ProductSupplierOrderingTerms_minimum_positive_or_null_check"
      CHECK ("minimumOrderQuantity" IS NULL OR "minimumOrderQuantity" > 0),
    CONSTRAINT "ProductSupplierOrderingTerms_multiple_positive_or_null_check"
      CHECK ("orderMultipleQuantity" IS NULL OR "orderMultipleQuantity" > 0)
);

CREATE UNIQUE INDEX "ProductSupplierOrderingTerms_relationshipId_key"
ON "ProductSupplierOrderingTerms"("relationshipId");

ALTER TABLE "ProductSupplierOrderingTerms"
ADD CONSTRAINT "ProductSupplierOrderingTerms_relationshipId_fkey"
FOREIGN KEY ("relationshipId") REFERENCES "ProductSupplyRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
