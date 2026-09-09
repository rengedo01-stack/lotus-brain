-- A planning target is intentionally nullable: existing thresholds do not imply
-- a human-selected target quantity, and null is distinct from the valid value 0.
ALTER TABLE "ReplenishmentPolicy"
ADD COLUMN "targetStockQuantity" DECIMAL(24,9);

-- The current policy is coherent only when a configured target is at or above
-- the threshold that starts replenishment review. Keep this at the database
-- boundary in addition to application validation.
ALTER TABLE "ReplenishmentPolicy"
ADD CONSTRAINT "ReplenishmentPolicy_target_at_least_reorder_check"
CHECK (
  "targetStockQuantity" IS NULL
  OR "targetStockQuantity" >= "reorderPointQuantity"
);
