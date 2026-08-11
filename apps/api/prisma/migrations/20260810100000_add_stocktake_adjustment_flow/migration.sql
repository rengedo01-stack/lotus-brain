-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentReason" AS ENUM ('STOCKTAKE_DIFFERENCE', 'SHRINKAGE', 'DAMAGE', 'ROUNDING', 'OTHER');

-- AlterTable
ALTER TABLE "InventoryHistory" ADD COLUMN "sourceInventoryAdjustmentItemId" TEXT;

-- CreateTable
CREATE TABLE "Stocktake" (
    "id" TEXT NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StocktakeItem" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryUnitId" TEXT NOT NULL,
    "systemQuantitySnapshot" DECIMAL(24,9),
    "countedQuantity" DECIMAL(24,9),
    "differenceQuantity" DECIMAL(24,9),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StocktakeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "status" "InventoryAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAdjustmentItem" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "stocktakeItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "inventoryUnitId" TEXT NOT NULL,
    "quantityDelta" DECIMAL(24,9) NOT NULL,
    "reason" "InventoryAdjustmentReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryHistory_sourceInventoryAdjustmentItemId_key" ON "InventoryHistory"("sourceInventoryAdjustmentItemId");
CREATE INDEX "Stocktake_status_createdAt_idx" ON "Stocktake"("status", "createdAt");
CREATE UNIQUE INDEX "StocktakeItem_stocktakeId_productId_key" ON "StocktakeItem"("stocktakeId", "productId");
CREATE INDEX "StocktakeItem_productId_idx" ON "StocktakeItem"("productId");
CREATE INDEX "StocktakeItem_inventoryUnitId_idx" ON "StocktakeItem"("inventoryUnitId");
CREATE UNIQUE INDEX "InventoryAdjustment_stocktakeId_key" ON "InventoryAdjustment"("stocktakeId");
CREATE INDEX "InventoryAdjustment_status_createdAt_idx" ON "InventoryAdjustment"("status", "createdAt");
CREATE UNIQUE INDEX "InventoryAdjustmentItem_stocktakeItemId_key" ON "InventoryAdjustmentItem"("stocktakeItemId");
CREATE INDEX "InventoryAdjustmentItem_adjustmentId_idx" ON "InventoryAdjustmentItem"("adjustmentId");
CREATE INDEX "InventoryAdjustmentItem_productId_idx" ON "InventoryAdjustmentItem"("productId");
CREATE INDEX "InventoryAdjustmentItem_inventoryId_idx" ON "InventoryAdjustmentItem"("inventoryId");

-- AddForeignKey
ALTER TABLE "InventoryHistory" ADD CONSTRAINT "InventoryHistory_sourceInventoryAdjustmentItemId_fkey" FOREIGN KEY ("sourceInventoryAdjustmentItemId") REFERENCES "InventoryAdjustmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeItem" ADD CONSTRAINT "StocktakeItem_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeItem" ADD CONSTRAINT "StocktakeItem_productId_inventoryUnitId_fkey" FOREIGN KEY ("productId", "inventoryUnitId") REFERENCES "Product"("id", "inventoryUnitId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeItem" ADD CONSTRAINT "StocktakeItem_inventoryUnitId_fkey" FOREIGN KEY ("inventoryUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentItem" ADD CONSTRAINT "InventoryAdjustmentItem_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "InventoryAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentItem" ADD CONSTRAINT "InventoryAdjustmentItem_stocktakeItemId_fkey" FOREIGN KEY ("stocktakeItemId") REFERENCES "StocktakeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentItem" ADD CONSTRAINT "InventoryAdjustmentItem_productId_inventoryUnitId_fkey" FOREIGN KEY ("productId", "inventoryUnitId") REFERENCES "Product"("id", "inventoryUnitId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentItem" ADD CONSTRAINT "InventoryAdjustmentItem_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentItem" ADD CONSTRAINT "InventoryAdjustmentItem_inventoryUnitId_fkey" FOREIGN KEY ("inventoryUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "InventoryHistory"
DROP CONSTRAINT "InventoryHistory_single_business_source_check";

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_single_business_source_check"
CHECK (
  num_nonnulls(
    "sourcePurchaseItemId",
    "sourceProductionConsumptionId",
    "sourceProductionId",
    "sourceInventoryAdjustmentItemId"
  ) <= 1
);

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_stocktake_adjustment_source_check"
CHECK (
  "sourceInventoryAdjustmentItemId" IS NULL
  OR "type" = 'STOCKTAKE_ADJUSTMENT'
);

ALTER TABLE "InventoryAdjustmentItem"
ADD CONSTRAINT "InventoryAdjustmentItem_quantity_delta_reason_check"
CHECK ("reason" IS NOT NULL);

ALTER TABLE "StocktakeItem"
ADD CONSTRAINT "StocktakeItem_snapshot_values_check"
CHECK (
  ("systemQuantitySnapshot" IS NULL OR "systemQuantitySnapshot" >= 0)
  AND ("countedQuantity" IS NULL OR "countedQuantity" >= 0)
);

ALTER TABLE "InventoryAdjustment"
ADD CONSTRAINT "InventoryAdjustment_status_timestamp_check"
CHECK (
  ("status" = 'DRAFT'::"InventoryAdjustmentStatus" AND "postedAt" IS NULL)
  OR ("status" = 'POSTED'::"InventoryAdjustmentStatus" AND "postedAt" IS NOT NULL)
  OR ("status" = 'CANCELLED'::"InventoryAdjustmentStatus")
);

ALTER TABLE "Stocktake"
ADD CONSTRAINT "Stocktake_status_timestamp_check"
CHECK (
  ("status" = 'DRAFT'::"StocktakeStatus" AND "startedAt" IS NULL AND "completedAt" IS NULL)
  OR ("status" = 'CONFIRMED'::"StocktakeStatus" AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
  OR ("status" = 'POSTED'::"StocktakeStatus" AND "completedAt" IS NOT NULL)
  OR ("status" = 'CANCELLED'::"StocktakeStatus")
);

-- CreateFunction
CREATE FUNCTION "prevent_stocktake_item_mutation_after_confirmation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "StocktakeStatus";
BEGIN
  SELECT s."status"
  INTO parent_status
  FROM "Stocktake" AS s
  WHERE s."id" = OLD."stocktakeId"
  FOR SHARE;

  IF parent_status <> 'DRAFT'::"StocktakeStatus" THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Stocktake item % cannot be removed after Stocktake % is %.', OLD."id", OLD."stocktakeId", parent_status USING ERRCODE = '23514';
    END IF;

    IF NEW."stocktakeId" IS DISTINCT FROM OLD."stocktakeId"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."inventoryUnitId" IS DISTINCT FROM OLD."inventoryUnitId"
      OR NEW."systemQuantitySnapshot" IS DISTINCT FROM OLD."systemQuantitySnapshot"
      OR NEW."countedQuantity" IS DISTINCT FROM OLD."countedQuantity"
      OR NEW."differenceQuantity" IS DISTINCT FROM OLD."differenceQuantity"
      OR NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'Stocktake item % cannot change after Stocktake % is %.', OLD."id", OLD."stocktakeId", parent_status USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "StocktakeItem_prevent_mutation_after_confirmation_trigger"
BEFORE UPDATE OR DELETE ON "StocktakeItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_stocktake_item_mutation_after_confirmation"();

CREATE FUNCTION "prevent_posted_stocktake_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'POSTED'::"StocktakeStatus" THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'Stocktake % cannot be changed after it is POSTED.', OLD."id" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Stocktake_prevent_posted_mutation_trigger"
BEFORE UPDATE ON "Stocktake"
FOR EACH ROW
EXECUTE FUNCTION "prevent_posted_stocktake_mutation"();

CREATE FUNCTION "prevent_posted_adjustment_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'POSTED'::"InventoryAdjustmentStatus" THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."stocktakeId" IS DISTINCT FROM OLD."stocktakeId"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'Inventory adjustment % cannot change after it is POSTED.', OLD."id" USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryAdjustment_prevent_posted_mutation_trigger"
BEFORE UPDATE ON "InventoryAdjustment"
FOR EACH ROW
EXECUTE FUNCTION "prevent_posted_adjustment_mutation"();

CREATE FUNCTION "prevent_posted_adjustment_item_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "InventoryAdjustmentStatus";
BEGIN
  SELECT a."status"
  INTO parent_status
  FROM "InventoryAdjustment" AS a
  WHERE a."id" = OLD."adjustmentId"
  FOR SHARE;

  IF parent_status = 'POSTED'::"InventoryAdjustmentStatus" THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Inventory adjustment item % cannot be removed after adjustment % is POSTED.', OLD."id", OLD."adjustmentId" USING ERRCODE = '23514';
    END IF;

    IF NEW."adjustmentId" IS DISTINCT FROM OLD."adjustmentId"
      OR NEW."stocktakeItemId" IS DISTINCT FROM OLD."stocktakeItemId"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."inventoryId" IS DISTINCT FROM OLD."inventoryId"
      OR NEW."inventoryUnitId" IS DISTINCT FROM OLD."inventoryUnitId"
      OR NEW."quantityDelta" IS DISTINCT FROM OLD."quantityDelta"
      OR NEW."reason" IS DISTINCT FROM OLD."reason"
      OR NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'Inventory adjustment item % cannot change after adjustment % is POSTED.', OLD."id", OLD."adjustmentId" USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryAdjustmentItem_prevent_posted_mutation_trigger"
BEFORE UPDATE OR DELETE ON "InventoryAdjustmentItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_posted_adjustment_item_mutation"();

CREATE FUNCTION "inventory_history_requires_posted_stocktake_adjustment"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment_status "InventoryAdjustmentStatus";
  stocktake_status "StocktakeStatus";
  item_product_id TEXT;
  item_inventory_unit_id TEXT;
  item_inventory_id TEXT;
BEGIN
  IF NEW."sourceInventoryAdjustmentItemId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a."status", s."status", ai."productId", ai."inventoryUnitId", ai."inventoryId"
  INTO adjustment_status, stocktake_status, item_product_id, item_inventory_unit_id, item_inventory_id
  FROM "InventoryAdjustmentItem" AS ai
  INNER JOIN "InventoryAdjustment" AS a ON a."id" = ai."adjustmentId"
  INNER JOIN "Stocktake" AS s ON s."id" = a."stocktakeId"
  WHERE ai."id" = NEW."sourceInventoryAdjustmentItemId"
  FOR NO KEY UPDATE OF ai FOR SHARE OF a, s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory adjustment item % must exist before a history can reference it.', NEW."sourceInventoryAdjustmentItemId"
      USING ERRCODE = '23503';
  END IF;

  IF adjustment_status <> 'POSTED'::"InventoryAdjustmentStatus"
    OR stocktake_status <> 'POSTED'::"StocktakeStatus" THEN
    RAISE EXCEPTION 'Inventory adjustment item % requires a POSTED adjustment and POSTED stocktake.', NEW."sourceInventoryAdjustmentItemId"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."type" <> 'STOCKTAKE_ADJUSTMENT'::"InventoryTransactionType" THEN
    RAISE EXCEPTION 'Inventory history % must use STOCKTAKE_ADJUSTMENT when sourceInventoryAdjustmentItemId is set.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."inventoryUnitId" <> item_inventory_unit_id THEN
    RAISE EXCEPTION 'Inventory history % must use the adjustment item inventory unit.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "Inventory" AS inventory
    WHERE inventory."id" = NEW."inventoryId"
      AND inventory."productId" = item_product_id
  ) THEN
    RAISE EXCEPTION 'Inventory history % must point to the adjustment item product inventory.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."inventoryId" <> item_inventory_id THEN
    RAISE EXCEPTION 'Inventory history % must reuse the adjustment item inventory row.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryHistory_require_posted_stocktake_adjustment_trigger"
BEFORE INSERT OR UPDATE ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "inventory_history_requires_posted_stocktake_adjustment"();

CREATE FUNCTION "prevent_stocktake_adjustment_source_reassignment"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourceInventoryAdjustmentItemId" IS NOT NULL
    AND NEW."sourceInventoryAdjustmentItemId" IS DISTINCT FROM OLD."sourceInventoryAdjustmentItemId" THEN
    RAISE EXCEPTION 'Inventory history % cannot be reassigned to another inventory adjustment item.', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryHistory_prevent_stocktake_adjustment_source_reassignment_trigger"
BEFORE UPDATE OF "sourceInventoryAdjustmentItemId" ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "prevent_stocktake_adjustment_source_reassignment"();
