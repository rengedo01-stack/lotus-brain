ALTER TABLE "InventoryHistory" ADD COLUMN "sourceProductionId" TEXT;

CREATE UNIQUE INDEX "InventoryHistory_sourceProductionId_key"
ON "InventoryHistory"("sourceProductionId");

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_sourceProductionId_fkey"
FOREIGN KEY ("sourceProductionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryHistory"
DROP CONSTRAINT "InventoryHistory_single_business_source_check";

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_single_business_source_check"
CHECK (num_nonnulls("sourcePurchaseItemId", "sourceProductionConsumptionId", "sourceProductionId") <= 1);

CREATE FUNCTION "require_posted_production_output_receipt"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  output_product_id TEXT;
  output_inventory_unit_id TEXT;
  production_status "ProductionStatus";
BEGIN
  IF NEW."sourceProductionId" IS NULL THEN RETURN NEW; END IF;

  SELECT p."outputProductIdSnapshot", product."inventoryUnitId", p."status"
  INTO output_product_id, output_inventory_unit_id, production_status
  FROM "Production" AS p
  INNER JOIN "Product" AS product ON product."id" = p."outputProductIdSnapshot"
  WHERE p."id" = NEW."sourceProductionId"
  FOR SHARE OF p;

  IF NOT FOUND THEN RAISE EXCEPTION 'Production output source must exist.' USING ERRCODE = '23503'; END IF;
  IF production_status <> 'POSTED'::"ProductionStatus" THEN RAISE EXCEPTION 'Production output receipt requires POSTED Production.' USING ERRCODE = '23514'; END IF;
  IF NEW."type" <> 'PRODUCTION_RECEIPT'::"InventoryTransactionType" THEN RAISE EXCEPTION 'Production output receipt must use PRODUCTION_RECEIPT.' USING ERRCODE = '23514'; END IF;
  IF NEW."quantityDelta" <= 0 THEN RAISE EXCEPTION 'Production output receipt quantity must be positive.' USING ERRCODE = '23514'; END IF;
  IF NEW."inventoryUnitId" <> output_inventory_unit_id THEN RAISE EXCEPTION 'Production output receipt must use output inventory unit.' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Inventory" AS inventory WHERE inventory."id" = NEW."inventoryId" AND inventory."productId" = output_product_id) THEN RAISE EXCEPTION 'Production output receipt inventory must belong to output product.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryHistory_require_posted_production_output_receipt_trigger"
BEFORE INSERT OR UPDATE ON "InventoryHistory"
FOR EACH ROW EXECUTE FUNCTION "require_posted_production_output_receipt"();
