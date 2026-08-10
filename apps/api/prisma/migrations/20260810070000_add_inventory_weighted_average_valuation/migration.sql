-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN "averageUnitCost" DECIMAL(20,6);

-- AddCheckConstraint
ALTER TABLE "Inventory"
ADD CONSTRAINT "Inventory_average_unit_cost_non_negative_check"
CHECK ("averageUnitCost" IS NULL OR "averageUnitCost" >= 0);
