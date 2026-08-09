-- AddCheckConstraint
-- ProductionConsumption snapshots are stored at the schema's declared
-- precision: quantities at 9 decimal places and monetary amounts at 6.
ALTER TABLE "ProductionConsumption"
ADD CONSTRAINT "ProductionConsumption_quantity_and_amount_snapshot_formula_check"
CHECK (
  "inventoryQuantity" = ROUND("recipeQuantitySnapshot" * "conversionFactorSnapshot", 9)
  AND "amountSnapshot" = ROUND("inventoryQuantity" * "unitCostSnapshot", 6)
);
