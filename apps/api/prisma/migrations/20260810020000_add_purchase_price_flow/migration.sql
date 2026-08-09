-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseLogEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'IMPORTED');

-- AlterTable
ALTER TABLE "InventoryHistory" ADD COLUMN "sourcePurchaseItemId" TEXT;

-- AlterTable
ALTER TABLE "PriceHistory" ADD COLUMN "sourcePurchaseItemId" TEXT;

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "documentNumber" VARCHAR(100),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'JPY',
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "tax" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "note" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "quantity" DECIMAL(24,9) NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "lineAmount" DECIMAL(20,6) NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLog" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "eventType" "PurchaseLogEventType" NOT NULL,
    "fromStatus" "PurchaseStatus",
    "toStatus" "PurchaseStatus",
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Purchase_supplierId_purchaseDate_idx" ON "Purchase"("supplierId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Purchase_status_purchaseDate_idx" ON "Purchase"("status", "purchaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_supplierId_documentNumber_key" ON "Purchase"("supplierId", "documentNumber");

-- CreateIndex
CREATE INDEX "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseItem_unitId_idx" ON "PurchaseItem"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseItem_purchaseId_lineNumber_key" ON "PurchaseItem"("purchaseId", "lineNumber");

-- CreateIndex
CREATE INDEX "PurchaseLog_purchaseId_occurredAt_idx" ON "PurchaseLog"("purchaseId", "occurredAt");

-- CreateIndex
CREATE INDEX "PurchaseLog_toStatus_occurredAt_idx" ON "PurchaseLog"("toStatus", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryHistory_sourcePurchaseItemId_key" ON "InventoryHistory"("sourcePurchaseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceHistory_sourcePurchaseItemId_key" ON "PriceHistory"("sourcePurchaseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_inventoryUnitId_key" ON "Product"("id", "inventoryUnitId");

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_sourcePurchaseItemId_fkey" FOREIGN KEY ("sourcePurchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHistory" ADD CONSTRAINT "InventoryHistory_sourcePurchaseItemId_fkey" FOREIGN KEY ("sourcePurchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_productId_unitId_fkey" FOREIGN KEY ("productId", "unitId") REFERENCES "Product"("id", "inventoryUnitId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLog" ADD CONSTRAINT "PurchaseLog_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_amounts_nonnegative_check"
CHECK ("subtotal" >= 0 AND "tax" >= 0 AND "total" >= 0);

-- AddCheckConstraint
ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_total_matches_subtotal_and_tax_check"
CHECK ("total" = "subtotal" + "tax");

-- AddCheckConstraint
ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_status_timestamps_check"
CHECK (
  ("status" = 'POSTED' AND "postedAt" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" IN ('DRAFT', 'CONFIRMED') AND "postedAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
);

-- AddCheckConstraint
ALTER TABLE "PurchaseItem"
ADD CONSTRAINT "PurchaseItem_quantity_price_amount_taxRate_check"
CHECK (
  "quantity" > 0
  AND "unitPrice" >= 0
  AND "lineAmount" >= 0
  AND "taxRate" >= 0
  AND "taxRate" <= 1
);

-- AddCheckConstraint
ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_purchase_source_is_receipt_check"
CHECK ("sourcePurchaseItemId" IS NULL OR "type" = 'RECEIPT');
