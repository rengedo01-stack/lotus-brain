-- Production lifecycle foundation. The output conversion is added in a
-- deliberately forward-only form: historical POSTED rows are reconstructed
-- only from their immutable output receipt, while any other legacy row stops
-- the migration rather than silently adopting current master data.
ALTER TABLE "Production"
ADD COLUMN "outputConversionFactorSnapshot" DECIMAL(30,12);

UPDATE "Production" AS production
SET "outputConversionFactorSnapshot" = ROUND(history."quantityDelta" / production."actualQuantity", 12)
FROM "InventoryHistory" AS history
WHERE history."sourceProductionId" = production."id"
  AND production."status" = 'POSTED'::"ProductionStatus"
  AND production."actualQuantity" > 0
  AND history."type" = 'PRODUCTION_RECEIPT'::"InventoryTransactionType"
  AND history."quantityDelta" > 0;

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO unresolved_count
  FROM "Production"
  WHERE "outputConversionFactorSnapshot" IS NULL
     OR "outputConversionFactorSnapshot" <= 0;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot safely backfill Production.outputConversionFactorSnapshot: % legacy Production rows are unresolved. Resolve them explicitly before this migration.',
      unresolved_count
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "Production"
ALTER COLUMN "outputConversionFactorSnapshot" SET NOT NULL,
ALTER COLUMN "outputConversionFactorSnapshot" SET DEFAULT 1;

ALTER TABLE "Production"
ADD CONSTRAINT "Production_output_conversion_factor_snapshot_check"
CHECK ("outputConversionFactorSnapshot" > 0);

-- E0 makes ACTIVE Recipe structure immutable. This trigger makes that status
-- the database-enforced input boundary and captures every output value in the
-- same insert statement. The default exists only for Prisma's generated input
-- type; this trigger always supplies the real snapshot.
CREATE OR REPLACE FUNCTION "set_production_output_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recipe_status "RecipeStatus";
BEGIN
  SELECT recipe."outputProductId", recipe."yieldQuantity", recipe."yieldUnitId", recipe."status"
  INTO NEW."outputProductIdSnapshot", NEW."yieldQuantitySnapshot", NEW."outputUnitIdSnapshot", recipe_status
  FROM "Recipe" AS recipe
  WHERE recipe."id" = NEW."recipeId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe % must exist before creating Production.', NEW."recipeId"
      USING ERRCODE = '23503';
  END IF;

  IF recipe_status <> 'ACTIVE'::"RecipeStatus" THEN
    RAISE EXCEPTION 'Production creation requires an ACTIVE Recipe.' USING ERRCODE = '23514';
  END IF;

  PERFORM product."id"
  FROM "Product" AS product
  INNER JOIN "Unit" AS base_unit ON base_unit."id" = product."baseUnitId"
  INNER JOIN "Unit" AS inventory_unit ON inventory_unit."id" = product."inventoryUnitId"
  INNER JOIN "Unit" AS output_unit ON output_unit."id" = NEW."outputUnitIdSnapshot"
  WHERE product."id" = NEW."outputProductIdSnapshot"
    AND product."status" = 'ACTIVE'::"MasterStatus"
    AND product."deletedAt" IS NULL
    AND base_unit."status" = 'ACTIVE'::"MasterStatus"
    AND inventory_unit."status" = 'ACTIVE'::"MasterStatus"
    AND output_unit."status" = 'ACTIVE'::"MasterStatus"
  FOR SHARE OF product, base_unit, inventory_unit, output_unit;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production output Product and Units must be active.' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> 'DRAFT'::"ProductionStatus" THEN
    RAISE EXCEPTION 'Production creation requires DRAFT status.' USING ERRCODE = '23514';
  END IF;

  NEW."outputConversionFactorSnapshot" := "product_unit_factor_to_inventory"(
    NEW."outputProductIdSnapshot",
    NEW."outputUnitIdSnapshot"
  );
  RETURN NEW;
END;
$$;

-- A Production's business fields can move only through the declared state
-- machine. DRAFT is the sole editable state, while recipe/output snapshots are
-- immutable for the complete lifetime of the row.
CREATE OR REPLACE FUNCTION "prevent_production_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId" THEN
    RAISE EXCEPTION 'Production % cannot be reassigned to another Recipe.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."outputProductIdSnapshot" IS DISTINCT FROM OLD."outputProductIdSnapshot"
    OR NEW."yieldQuantitySnapshot" IS DISTINCT FROM OLD."yieldQuantitySnapshot"
    OR NEW."outputUnitIdSnapshot" IS DISTINCT FROM OLD."outputUnitIdSnapshot"
    OR NEW."outputConversionFactorSnapshot" IS DISTINCT FROM OLD."outputConversionFactorSnapshot" THEN
    RAISE EXCEPTION 'Production % output snapshots are immutable.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'DRAFT'::"ProductionStatus"
      AND NEW."status" = 'CONFIRMED'::"ProductionStatus" THEN
      NULL;
    ELSIF OLD."status" = 'CONFIRMED'::"ProductionStatus"
      AND NEW."status" = 'POSTED'::"ProductionStatus" THEN
      NULL;
    ELSIF OLD."status" IN ('DRAFT'::"ProductionStatus", 'CONFIRMED'::"ProductionStatus")
      AND NEW."status" = 'CANCELLED'::"ProductionStatus" THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Production % cannot transition from % to %.', OLD."id", OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND (
      NEW."productionDate" IS DISTINCT FROM OLD."productionDate"
      OR NEW."plannedQuantity" IS DISTINCT FROM OLD."plannedQuantity"
      OR NEW."note" IS DISTINCT FROM OLD."note"
    ) THEN
    RAISE EXCEPTION 'Production % state transitions cannot change DRAFT fields.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'DRAFT'::"ProductionStatus"
    AND (
      NEW."productionDate" IS DISTINCT FROM OLD."productionDate"
      OR NEW."plannedQuantity" IS DISTINCT FROM OLD."plannedQuantity"
      OR NEW."note" IS DISTINCT FROM OLD."note"
    ) THEN
    RAISE EXCEPTION 'Only DRAFT Production % can change its editable fields.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'DRAFT'::"ProductionStatus"
    AND NEW."status" = OLD."status"
    AND (
      NEW."actualQuantity" IS DISTINCT FROM OLD."actualQuantity"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
    ) THEN
    RAISE EXCEPTION 'DRAFT Production % cannot change posting fields.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'CONFIRMED'::"ProductionStatus"
    AND NEW."status" = OLD."status"
    AND (
      NEW."actualQuantity" IS DISTINCT FROM OLD."actualQuantity"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
    ) THEN
    RAISE EXCEPTION 'CONFIRMED Production % can change posting fields only while posting.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('POSTED'::"ProductionStatus", 'CANCELLED'::"ProductionStatus")
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."actualQuantity" IS DISTINCT FROM OLD."actualQuantity"
      OR NEW."productionDate" IS DISTINCT FROM OLD."productionDate"
      OR NEW."plannedQuantity" IS DISTINCT FROM OLD."plannedQuantity"
      OR NEW."note" IS DISTINCT FROM OLD."note"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
    ) THEN
    RAISE EXCEPTION 'Historical Production % cannot be changed.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- The source identity and conversion of an ingredient are immutable at draft
-- creation. Accounting values remain writable only while a CONFIRMED
-- Production is being posted by the existing posting transaction.
CREATE OR REPLACE FUNCTION "prevent_posted_production_consumption_snapshot_change"()
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

  IF NEW."productionId" IS DISTINCT FROM OLD."productionId"
    OR NEW."productId" IS DISTINCT FROM OLD."productId"
    OR NEW."lineNumber" IS DISTINCT FROM OLD."lineNumber"
    OR NEW."recipeUnitId" IS DISTINCT FROM OLD."recipeUnitId"
    OR NEW."inventoryUnitId" IS DISTINCT FROM OLD."inventoryUnitId"
    OR NEW."conversionFactorSnapshot" IS DISTINCT FROM OLD."conversionFactorSnapshot"
    OR NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    RAISE EXCEPTION 'Production consumption % source snapshots are immutable.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF parent_status <> 'CONFIRMED'::"ProductionStatus"
    AND (
      NEW."recipeQuantitySnapshot" IS DISTINCT FROM OLD."recipeQuantitySnapshot"
      OR NEW."inventoryQuantity" IS DISTINCT FROM OLD."inventoryQuantity"
      OR NEW."unitCostSnapshot" IS DISTINCT FROM OLD."unitCostSnapshot"
      OR NEW."amountSnapshot" IS DISTINCT FROM OLD."amountSnapshot"
    ) THEN
    RAISE EXCEPTION 'Production consumption % accounting values can change only while its Production is CONFIRMED.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- The original conversion trigger remains the source of the exact formula.
-- This replacement also holds the active master rows through the insert or
-- update statement, so a direct SQL client cannot create a snapshot from an
-- already inactive Product, Unit, or conversion.
CREATE OR REPLACE FUNCTION "validate_production_consumption_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_factor NUMERIC;
  product_base_unit_id TEXT;
  product_inventory_unit_id TEXT;
  conversion_id TEXT;
BEGIN
  SELECT product."baseUnitId", product."inventoryUnitId"
  INTO product_base_unit_id, product_inventory_unit_id
  FROM "Product" AS product
  INNER JOIN "Unit" AS base_unit ON base_unit."id" = product."baseUnitId"
  INNER JOIN "Unit" AS inventory_unit ON inventory_unit."id" = product."inventoryUnitId"
  INNER JOIN "Unit" AS recipe_unit ON recipe_unit."id" = NEW."recipeUnitId"
  WHERE product."id" = NEW."productId"
    AND product."status" = 'ACTIVE'::"MasterStatus"
    AND product."deletedAt" IS NULL
    AND base_unit."status" = 'ACTIVE'::"MasterStatus"
    AND inventory_unit."status" = 'ACTIVE'::"MasterStatus"
    AND recipe_unit."status" = 'ACTIVE'::"MasterStatus"
  FOR SHARE OF product, base_unit, inventory_unit, recipe_unit;

  IF NOT FOUND OR NEW."inventoryUnitId" <> product_inventory_unit_id THEN
    RAISE EXCEPTION 'Production consumption Product and Units must be active and use its Product inventory unit.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."recipeUnitId" <> product_base_unit_id THEN
    SELECT "id" INTO conversion_id
    FROM "ProductUnitConversion"
    WHERE "productId" = NEW."productId"
      AND "unitId" = NEW."recipeUnitId"
      AND "status" = 'ACTIVE'::"MasterStatus"
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Production consumption Recipe Unit has no active Product conversion.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF product_inventory_unit_id <> product_base_unit_id THEN
    SELECT "id" INTO conversion_id
    FROM "ProductUnitConversion"
    WHERE "productId" = NEW."productId"
      AND "unitId" = product_inventory_unit_id
      AND "status" = 'ACTIVE'::"MasterStatus"
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Production consumption inventory Unit has no active Product conversion.' USING ERRCODE = '23514';
    END IF;
  END IF;

  expected_factor := "product_unit_factor_to_inventory"(NEW."productId", NEW."recipeUnitId");
  IF NEW."conversionFactorSnapshot" <> expected_factor THEN
    RAISE EXCEPTION 'Production consumption % must snapshot the current conversion factor % for Product % and Unit %.', NEW."id", expected_factor, NEW."productId", NEW."recipeUnitId"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "prevent_production_consumption_deletion"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Production consumption % cannot be deleted after creation.', OLD."id"
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ProductionConsumption_prevent_deletion_trigger"
BEFORE DELETE ON "ProductionConsumption"
FOR EACH ROW
EXECUTE FUNCTION "prevent_production_consumption_deletion"();

-- Add the typed registry entries. Future custom roles can receive these via
-- Authorization Administration; only SYSTEM_ADMIN receives them automatically.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-production-read', 'production.read', 'Read productions.'),
  ('rbac-permission-production-write', 'production.write', 'Create or update production drafts.'),
  ('rbac-permission-production-confirm', 'production.confirm', 'Confirm production drafts.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
JOIN "Permission" ON "Permission"."code" IN ('production.read', 'production.write', 'production.confirm')
WHERE "Role"."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
