-- Human-managed replenishment thresholds are current master data. They are
-- intentionally not recommendations, order quantities, or projected stock.
CREATE TABLE "ReplenishmentPolicy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reorderPointQuantity" DECIMAL(24,9) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplenishmentPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReplenishmentPolicy_reorderPointQuantity_nonnegative_check" CHECK ("reorderPointQuantity" >= 0),
    CONSTRAINT "ReplenishmentPolicy_version_positive_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ReplenishmentPolicy_productId_key" ON "ReplenishmentPolicy"("productId");

ALTER TABLE "ReplenishmentPolicy"
ADD CONSTRAINT "ReplenishmentPolicy_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
