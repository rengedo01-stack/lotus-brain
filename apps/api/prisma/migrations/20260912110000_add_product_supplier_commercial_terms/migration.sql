CREATE TABLE "ProductSupplierCommercialTerms" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSupplierCommercialTerms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductSupplierCommercialTerms_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "ProductSupplierCommercialTerms_unitPrice_nonnegative_check" CHECK ("unitPrice" >= 0),
    CONSTRAINT "ProductSupplierCommercialTerms_taxRate_range_check" CHECK ("taxRate" >= 0 AND "taxRate" <= 1),
    CONSTRAINT "ProductSupplierCommercialTerms_currency_jpy_check" CHECK ("currencyCode" = 'JPY')
);

CREATE UNIQUE INDEX "ProductSupplierCommercialTerms_relationshipId_key"
ON "ProductSupplierCommercialTerms"("relationshipId");

ALTER TABLE "ProductSupplierCommercialTerms"
ADD CONSTRAINT "ProductSupplierCommercialTerms_relationshipId_fkey"
FOREIGN KEY ("relationshipId") REFERENCES "ProductSupplyRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
