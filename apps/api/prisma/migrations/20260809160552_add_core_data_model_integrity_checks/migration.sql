-- This is an empty migration.
-- AddCheckConstraint
ALTER TABLE "ProductUnitConversion"
ADD CONSTRAINT "ProductUnitConversion_factorToBaseUnit_positive_check"
CHECK ("factorToBaseUnit" > 0);

-- AddCheckConstraint
ALTER TABLE "PriceMaster"
ADD CONSTRAINT "PriceMaster_currentUnitPrice_nonnegative_check"
CHECK ("currentUnitPrice" >= 0);

-- AddCheckConstraint
ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_unitPrice_nonnegative_check"
CHECK ("unitPrice" >= 0);
