-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "InventoryHistory" ADD COLUMN "sourceProductionConsumptionId" TEXT;

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(24,9) NOT NULL,
    "yieldUnitId" TEXT NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "quantity" DECIMAL(24,9) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "plannedQuantity" DECIMAL(24,9) NOT NULL,
    "actualQuantity" DECIMAL(24,9),
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "postedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionConsumption" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "recipeQuantitySnapshot" DECIMAL(24,9) NOT NULL,
    "recipeUnitId" TEXT NOT NULL,
    "inventoryQuantity" DECIMAL(24,9) NOT NULL,
    "inventoryUnitId" TEXT NOT NULL,
    "conversionFactorSnapshot" DECIMAL(30,12) NOT NULL,
    "unitCostSnapshot" DECIMAL(20,6) NOT NULL,
    "amountSnapshot" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'JPY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recipe_status_outputProductId_idx" ON "Recipe"("status", "outputProductId");
CREATE INDEX "Recipe_yieldUnitId_idx" ON "Recipe"("yieldUnitId");
CREATE UNIQUE INDEX "Recipe_outputProductId_revision_key" ON "Recipe"("outputProductId", "revision");
CREATE INDEX "RecipeItem_productId_idx" ON "RecipeItem"("productId");
CREATE INDEX "RecipeItem_unitId_idx" ON "RecipeItem"("unitId");
CREATE UNIQUE INDEX "RecipeItem_recipeId_sortOrder_key" ON "RecipeItem"("recipeId", "sortOrder");
CREATE INDEX "Production_recipeId_productionDate_idx" ON "Production"("recipeId", "productionDate");
CREATE INDEX "Production_status_productionDate_idx" ON "Production"("status", "productionDate");
CREATE INDEX "ProductionConsumption_productId_idx" ON "ProductionConsumption"("productId");
CREATE INDEX "ProductionConsumption_recipeUnitId_idx" ON "ProductionConsumption"("recipeUnitId");
CREATE INDEX "ProductionConsumption_inventoryUnitId_idx" ON "ProductionConsumption"("inventoryUnitId");
CREATE UNIQUE INDEX "ProductionConsumption_productionId_lineNumber_key" ON "ProductionConsumption"("productionId", "lineNumber");
CREATE UNIQUE INDEX "InventoryHistory_sourceProductionConsumptionId_key" ON "InventoryHistory"("sourceProductionConsumptionId");

-- AddForeignKey
ALTER TABLE "InventoryHistory" ADD CONSTRAINT "InventoryHistory_sourceProductionConsumptionId_fkey" FOREIGN KEY ("sourceProductionConsumptionId") REFERENCES "ProductionConsumption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_yieldUnitId_fkey" FOREIGN KEY ("yieldUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Production" ADD CONSTRAINT "Production_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_productId_inventoryUnitId_fkey" FOREIGN KEY ("productId", "inventoryUnitId") REFERENCES "Product"("id", "inventoryUnitId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_recipeUnitId_fkey" FOREIGN KEY ("recipeUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionConsumption" ADD CONSTRAINT "ProductionConsumption_inventoryUnitId_fkey" FOREIGN KEY ("inventoryUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "Recipe"
ADD CONSTRAINT "Recipe_yield_quantity_and_revision_check"
CHECK ("yieldQuantity" > 0 AND "revision" > 0);

ALTER TABLE "RecipeItem"
ADD CONSTRAINT "RecipeItem_quantity_and_sort_order_check"
CHECK ("quantity" > 0 AND "sortOrder" >= 0);

ALTER TABLE "Production"
ADD CONSTRAINT "Production_quantities_and_status_timestamps_check"
CHECK (
  "plannedQuantity" > 0
  AND ("actualQuantity" IS NULL OR "actualQuantity" > 0)
  AND (
    ("status" = 'POSTED' AND "actualQuantity" IS NOT NULL AND "postedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    OR ("status" IN ('DRAFT', 'CONFIRMED') AND "actualQuantity" IS NULL AND "postedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  )
);

ALTER TABLE "ProductionConsumption"
ADD CONSTRAINT "ProductionConsumption_snapshot_values_check"
CHECK (
  "lineNumber" >= 0
  AND "recipeQuantitySnapshot" > 0
  AND "inventoryQuantity" > 0
  AND "conversionFactorSnapshot" > 0
  AND "unitCostSnapshot" >= 0
  AND "amountSnapshot" >= 0
);

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_production_source_is_consumption_check"
CHECK ("sourceProductionConsumptionId" IS NULL OR "type" = 'CONSUMPTION');

ALTER TABLE "InventoryHistory"
ADD CONSTRAINT "InventoryHistory_single_business_source_check"
CHECK (NOT ("sourcePurchaseItemId" IS NOT NULL AND "sourceProductionConsumptionId" IS NOT NULL));

-- CreateFunction
-- ProductUnitConversion remains canonical in one direction: one source unit is
-- expressed in Product.baseUnit. Base-unit identity is implicit and never stored.
CREATE FUNCTION "validate_product_unit_conversion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  product_base_unit_id TEXT;
  product_dimension "UnitDimension";
  conversion_dimension "UnitDimension";
BEGIN
  SELECT p."baseUnitId", base_unit."dimension", conversion_unit."dimension"
  INTO product_base_unit_id, product_dimension, conversion_dimension
  FROM "Product" AS p
  INNER JOIN "Unit" AS base_unit ON base_unit."id" = p."baseUnitId"
  INNER JOIN "Unit" AS conversion_unit ON conversion_unit."id" = NEW."unitId"
  WHERE p."id" = NEW."productId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % and conversion unit % must exist.', NEW."productId", NEW."unitId"
      USING ERRCODE = '23503';
  END IF;

  IF NEW."unitId" = product_base_unit_id THEN
    RAISE EXCEPTION 'Product % must not define an explicit identity conversion for its base unit %.', NEW."productId", NEW."unitId"
      USING ERRCODE = '23514';
  END IF;

  IF conversion_dimension <> product_dimension THEN
    RAISE EXCEPTION 'Unit % is not dimension-compatible with Product %.', NEW."unitId", NEW."productId"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "ProductUnitConversion_validate_canonical_definition_trigger"
BEFORE INSERT OR UPDATE OF "productId", "unitId" ON "ProductUnitConversion"
FOR EACH ROW
EXECUTE FUNCTION "validate_product_unit_conversion"();

-- CreateFunction
-- Returns the number of Product.inventoryUnit units represented by one source
-- unit. Non-base units must have active ProductUnitConversion definitions.
CREATE FUNCTION "product_unit_factor_to_inventory"(target_product_id TEXT, source_unit_id TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  base_unit_id TEXT;
  inventory_unit_id TEXT;
  source_factor NUMERIC;
  inventory_factor NUMERIC;
BEGIN
  SELECT "baseUnitId", "inventoryUnitId"
  INTO base_unit_id, inventory_unit_id
  FROM "Product"
  WHERE "id" = target_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist.', target_product_id
      USING ERRCODE = '23503';
  END IF;

  IF source_unit_id = base_unit_id THEN
    source_factor := 1;
  ELSE
    SELECT "factorToBaseUnit"
    INTO source_factor
    FROM "ProductUnitConversion"
    WHERE "productId" = target_product_id
      AND "unitId" = source_unit_id
      AND "status" = 'ACTIVE'::"MasterStatus";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unit % has no active conversion for Product %.', source_unit_id, target_product_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF inventory_unit_id = base_unit_id THEN
    inventory_factor := 1;
  ELSE
    SELECT "factorToBaseUnit"
    INTO inventory_factor
    FROM "ProductUnitConversion"
    WHERE "productId" = target_product_id
      AND "unitId" = inventory_unit_id
      AND "status" = 'ACTIVE'::"MasterStatus";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventory unit % has no active conversion for Product %.', inventory_unit_id, target_product_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN ROUND(source_factor / inventory_factor, 12);
END;
$$;

-- CreateFunction
CREATE FUNCTION "validate_recipe_item_conversion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "product_unit_factor_to_inventory"(NEW."productId", NEW."unitId");
  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "RecipeItem_validate_product_unit_conversion_trigger"
BEFORE INSERT OR UPDATE OF "productId", "unitId" ON "RecipeItem"
FOR EACH ROW
EXECUTE FUNCTION "validate_recipe_item_conversion"();

-- CreateFunction
CREATE FUNCTION "validate_recipe_yield_conversion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "product_unit_factor_to_inventory"(NEW."outputProductId", NEW."yieldUnitId");
  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "Recipe_validate_output_unit_conversion_trigger"
BEFORE INSERT OR UPDATE OF "outputProductId", "yieldUnitId" ON "Recipe"
FOR EACH ROW
EXECUTE FUNCTION "validate_recipe_yield_conversion"();

-- CreateFunction
CREATE FUNCTION "validate_production_consumption_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_factor NUMERIC;
BEGIN
  expected_factor := "product_unit_factor_to_inventory"(NEW."productId", NEW."recipeUnitId");

  IF NEW."conversionFactorSnapshot" <> expected_factor THEN
    RAISE EXCEPTION 'Production consumption % must snapshot the current conversion factor % for Product % and Unit %.', NEW."id", expected_factor, NEW."productId", NEW."recipeUnitId"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "ProductionConsumption_validate_snapshot_trigger"
BEFORE INSERT OR UPDATE OF "productId", "recipeUnitId", "inventoryUnitId", "conversionFactorSnapshot" ON "ProductionConsumption"
FOR EACH ROW
EXECUTE FUNCTION "validate_production_consumption_snapshot"();

-- CreateFunction
CREATE FUNCTION "prevent_production_consumption_reassignment"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."productionId" IS DISTINCT FROM OLD."productionId" THEN
    RAISE EXCEPTION 'Production consumption % cannot be reassigned to another production.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "ProductionConsumption_prevent_reassignment_trigger"
BEFORE UPDATE OF "productionId" ON "ProductionConsumption"
FOR EACH ROW
EXECUTE FUNCTION "prevent_production_consumption_reassignment"();

-- CreateFunction
CREATE FUNCTION "prevent_posted_production_consumption_snapshot_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "ProductionStatus";
BEGIN
  SELECT "status"
  INTO parent_status
  FROM "Production"
  WHERE "id" = OLD."productionId"
  FOR SHARE;

  IF parent_status = 'POSTED'::"ProductionStatus"
    AND (
      NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."lineNumber" IS DISTINCT FROM OLD."lineNumber"
      OR NEW."recipeQuantitySnapshot" IS DISTINCT FROM OLD."recipeQuantitySnapshot"
      OR NEW."recipeUnitId" IS DISTINCT FROM OLD."recipeUnitId"
      OR NEW."inventoryQuantity" IS DISTINCT FROM OLD."inventoryQuantity"
      OR NEW."inventoryUnitId" IS DISTINCT FROM OLD."inventoryUnitId"
      OR NEW."conversionFactorSnapshot" IS DISTINCT FROM OLD."conversionFactorSnapshot"
      OR NEW."unitCostSnapshot" IS DISTINCT FROM OLD."unitCostSnapshot"
      OR NEW."amountSnapshot" IS DISTINCT FROM OLD."amountSnapshot"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
    ) THEN
    RAISE EXCEPTION 'Production consumption % snapshots cannot change after Production % is POSTED.', OLD."id", OLD."productionId"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "ProductionConsumption_prevent_posted_snapshot_change_trigger"
BEFORE UPDATE ON "ProductionConsumption"
FOR EACH ROW
EXECUTE FUNCTION "prevent_posted_production_consumption_snapshot_change"();

-- CreateFunction
CREATE FUNCTION "require_posted_production_consumption"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_production_id TEXT;
  parent_production_status "ProductionStatus";
BEGIN
  IF NEW."sourceProductionConsumptionId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Keep the stock-effect lock order narrow and explicit: source consumption,
  -- then its parent Production. The source row cannot be reassigned, and SHARE
  -- prevents a concurrent status change while the inventory history is written.
  SELECT p."id", p."status"
  INTO parent_production_id, parent_production_status
  FROM "ProductionConsumption" AS pc
  INNER JOIN "Production" AS p ON p."id" = pc."productionId"
  WHERE pc."id" = NEW."sourceProductionConsumptionId"
  FOR NO KEY UPDATE OF pc FOR SHARE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production consumption % must belong to an existing production.', NEW."sourceProductionConsumptionId"
      USING ERRCODE = '23503';
  END IF;

  IF parent_production_status <> 'POSTED'::"ProductionStatus" THEN
    RAISE EXCEPTION 'Production % must be POSTED before a consumption inventory history can be written; current status is %.', parent_production_id, parent_production_status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "InventoryHistory_require_posted_production_consumption_trigger"
BEFORE INSERT OR UPDATE ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "require_posted_production_consumption"();

-- CreateFunction
CREATE FUNCTION "prevent_production_status_reassignment_with_consumption"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NEW."status" <> 'POSTED'::"ProductionStatus"
    AND EXISTS (
      SELECT 1
      FROM "ProductionConsumption" AS pc
      INNER JOIN "InventoryHistory" AS ih ON ih."sourceProductionConsumptionId" = pc."id"
      WHERE pc."productionId" = OLD."id"
    ) THEN
    RAISE EXCEPTION 'Production % cannot leave POSTED while consumption inventory history exists.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "Production_prevent_status_reassignment_with_consumption_trigger"
BEFORE UPDATE OF "status" ON "Production"
FOR EACH ROW
EXECUTE FUNCTION "prevent_production_status_reassignment_with_consumption"();
