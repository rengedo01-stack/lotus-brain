-- AlterTable
-- Output snapshots are backfilled from the referenced Recipe for any pre-existing
-- rows before becoming required. New rows are always populated by a DB trigger.
ALTER TABLE "Production"
ADD COLUMN "outputProductIdSnapshot" TEXT,
ADD COLUMN "yieldQuantitySnapshot" DECIMAL(24,9),
ADD COLUMN "outputUnitIdSnapshot" TEXT;

UPDATE "Production" AS production
SET
  "outputProductIdSnapshot" = recipe."outputProductId",
  "yieldQuantitySnapshot" = recipe."yieldQuantity",
  "outputUnitIdSnapshot" = recipe."yieldUnitId"
FROM "Recipe" AS recipe
WHERE recipe."id" = production."recipeId";

ALTER TABLE "Production"
ALTER COLUMN "outputProductIdSnapshot" SET NOT NULL,
ALTER COLUMN "yieldQuantitySnapshot" SET NOT NULL,
ALTER COLUMN "outputUnitIdSnapshot" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Production_outputProductIdSnapshot_idx" ON "Production"("outputProductIdSnapshot");
CREATE INDEX "Production_outputUnitIdSnapshot_idx" ON "Production"("outputUnitIdSnapshot");

-- AddForeignKey
ALTER TABLE "Production"
ADD CONSTRAINT "Production_outputProductIdSnapshot_fkey"
FOREIGN KEY ("outputProductIdSnapshot") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Production"
ADD CONSTRAINT "Production_outputUnitIdSnapshot_fkey"
FOREIGN KEY ("outputUnitIdSnapshot") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "Production"
ADD CONSTRAINT "Production_output_snapshot_yield_quantity_check"
CHECK ("yieldQuantitySnapshot" > 0);

-- CreateFunction
-- Locks Recipe rows in ID order before checking whether a Production references
-- them. Production inserts take a KEY SHARE lock on the same Recipe row, so a
-- structural Recipe update and a new Production cannot both pass concurrently.
CREATE FUNCTION "lock_unreferenced_recipe_definitions"(recipe_ids TEXT[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_recipe_id TEXT;
BEGIN
  PERFORM recipe."id"
  FROM "Recipe" AS recipe
  WHERE recipe."id" = ANY(recipe_ids)
  ORDER BY recipe."id"
  FOR UPDATE;

  SELECT production."recipeId"
  INTO referenced_recipe_id
  FROM "Production" AS production
  WHERE production."recipeId" = ANY(recipe_ids)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Recipe % is referenced by a Production and its structural definition is immutable. Create a new revision instead.', referenced_recipe_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- CreateFunction
CREATE FUNCTION "prevent_referenced_recipe_structure_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."outputProductId" IS DISTINCT FROM OLD."outputProductId"
    OR NEW."yieldQuantity" IS DISTINCT FROM OLD."yieldQuantity"
    OR NEW."yieldUnitId" IS DISTINCT FROM OLD."yieldUnitId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision" THEN
    PERFORM "lock_unreferenced_recipe_definitions"(ARRAY[OLD."id"]);
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "Recipe_prevent_referenced_structure_change_trigger"
BEFORE UPDATE ON "Recipe"
FOR EACH ROW
EXECUTE FUNCTION "prevent_referenced_recipe_structure_change"();

-- CreateFunction
CREATE FUNCTION "prevent_referenced_recipe_item_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "lock_unreferenced_recipe_definitions"(ARRAY[NEW."recipeId"]);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM "lock_unreferenced_recipe_definitions"(ARRAY[OLD."recipeId"]);
    RETURN OLD;
  END IF;

  IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId"
    OR NEW."productId" IS DISTINCT FROM OLD."productId"
    OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
    OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder" THEN
    PERFORM "lock_unreferenced_recipe_definitions"(ARRAY[OLD."recipeId", NEW."recipeId"]);
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "RecipeItem_prevent_referenced_change_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "RecipeItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_referenced_recipe_item_change"();

-- CreateFunction
-- The output definition is copied while the Recipe row is KEY SHARE locked.
-- The Recipe structural-lock trigger upgrades to UPDATE before checking for
-- Production references, which serializes concurrent definition changes.
CREATE FUNCTION "set_production_output_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT recipe."outputProductId", recipe."yieldQuantity", recipe."yieldUnitId"
  INTO NEW."outputProductIdSnapshot", NEW."yieldQuantitySnapshot", NEW."outputUnitIdSnapshot"
  FROM "Recipe" AS recipe
  WHERE recipe."id" = NEW."recipeId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe % must exist before creating Production.', NEW."recipeId"
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "Production_set_output_snapshot_trigger"
BEFORE INSERT ON "Production"
FOR EACH ROW
EXECUTE FUNCTION "set_production_output_snapshot"();

-- CreateFunction
CREATE FUNCTION "prevent_production_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- A Production's recipe and output definition are fixed when it is created.
  -- Recreate a DRAFT Production instead of reassigning it to another Recipe.
  IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId" THEN
    RAISE EXCEPTION 'Production % cannot be reassigned to another Recipe.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."outputProductIdSnapshot" IS DISTINCT FROM OLD."outputProductIdSnapshot"
    OR NEW."yieldQuantitySnapshot" IS DISTINCT FROM OLD."yieldQuantitySnapshot"
    OR NEW."outputUnitIdSnapshot" IS DISTINCT FROM OLD."outputUnitIdSnapshot" THEN
    RAISE EXCEPTION 'Production % output snapshots are immutable.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'POSTED'::"ProductionStatus" THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."actualQuantity" IS DISTINCT FROM OLD."actualQuantity"
      OR NEW."productionDate" IS DISTINCT FROM OLD."productionDate"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt" THEN
      RAISE EXCEPTION 'POSTED Production % cannot have its historical fields or status changed.', OLD."id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "Production_prevent_history_mutation_trigger"
BEFORE UPDATE ON "Production"
FOR EACH ROW
EXECUTE FUNCTION "prevent_production_history_mutation"();
