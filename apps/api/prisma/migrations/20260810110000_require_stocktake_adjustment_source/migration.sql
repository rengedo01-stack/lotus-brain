-- Expand the stocktake adjustment integrity rule so a STOCKTAKE_ADJUSTMENT
-- history cannot exist without its adjustment source.

ALTER TABLE "InventoryHistory"
DROP CONSTRAINT "InventoryHistory_stocktake_adjustment_source_check";

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_stocktake_adjustment_source_check"
CHECK (
  ("type" <> 'STOCKTAKE_ADJUSTMENT')
  OR ("sourceInventoryAdjustmentItemId" IS NOT NULL)
);
