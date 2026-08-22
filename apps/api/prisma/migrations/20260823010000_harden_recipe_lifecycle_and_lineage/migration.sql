-- Establish a durable Recipe lineage. Existing Recipe revisions were grouped
-- by output Product, so their earliest revision becomes the lineage root.
ALTER TABLE "Recipe" ADD COLUMN "rootRecipeId" TEXT;

WITH roots AS (
  SELECT DISTINCT ON ("outputProductId")
    "id",
    "outputProductId"
  FROM "Recipe"
  ORDER BY "outputProductId", "revision" ASC, "id" ASC
)
UPDATE "Recipe" AS recipe
SET "rootRecipeId" = roots."id"
FROM roots
WHERE recipe."outputProductId" = roots."outputProductId";

ALTER TABLE "Recipe" ALTER COLUMN "rootRecipeId" SET NOT NULL;

DROP INDEX "Recipe_outputProductId_revision_key";

CREATE UNIQUE INDEX "Recipe_rootRecipeId_revision_key"
ON "Recipe"("rootRecipeId", "revision");

CREATE INDEX "Recipe_rootRecipeId_idx"
ON "Recipe"("rootRecipeId");

ALTER TABLE "Recipe"
ADD CONSTRAINT "Recipe_rootRecipeId_fkey"
FOREIGN KEY ("rootRecipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "RecipeItem_recipeId_productId_key"
ON "RecipeItem"("recipeId", "productId");

-- A root points to itself and is revision 1. A child points directly to that
-- root and retains its output Product, so a revision can never switch lineage.
CREATE FUNCTION "validate_recipe_root_lineage"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  root_root_recipe_id TEXT;
  root_output_product_id TEXT;
BEGIN
  IF NEW."rootRecipeId" = NEW."id" THEN
    IF NEW."revision" <> 1 THEN
      RAISE EXCEPTION 'A root Recipe must have revision 1.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT root."rootRecipeId", root."outputProductId"
  INTO root_root_recipe_id, root_output_product_id
  FROM "Recipe" AS root
  WHERE root."id" = NEW."rootRecipeId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe root % must exist.', NEW."rootRecipeId" USING ERRCODE = '23503';
  END IF;

  IF root_root_recipe_id <> NEW."rootRecipeId" THEN
    RAISE EXCEPTION 'Recipe root % must point to itself.', NEW."rootRecipeId" USING ERRCODE = '23514';
  END IF;

  IF NEW."outputProductId" <> root_output_product_id THEN
    RAISE EXCEPTION 'Recipe revision output Product must match its root Recipe.' USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" <= 1 THEN
    RAISE EXCEPTION 'A non-root Recipe revision must be greater than 1.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Recipe_validate_root_lineage_trigger"
BEFORE INSERT OR UPDATE OF "rootRecipeId", "outputProductId", "revision" ON "Recipe"
FOR EACH ROW
EXECUTE FUNCTION "validate_recipe_root_lineage"();

-- Recipe lifecycle is a database invariant, not only an API convention. The
-- only valid transitions are DRAFT -> ACTIVE and ACTIVE -> ARCHIVED. Metadata
-- remains editable, but a Recipe's output identity is fixed at creation and
-- its other structural fields are fixed once it leaves DRAFT.
CREATE FUNCTION "enforce_recipe_lifecycle_and_structure"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT'::"RecipeStatus" THEN
      RAISE EXCEPTION 'Recipe creation requires DRAFT status.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."rootRecipeId" IS DISTINCT FROM OLD."rootRecipeId" THEN
    RAISE EXCEPTION 'Recipe % cannot change its lineage root.', OLD."id" USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" THEN
    RAISE EXCEPTION 'Recipe % cannot change its revision number.', OLD."id" USING ERRCODE = '23514';
  END IF;

  IF NEW."outputProductId" IS DISTINCT FROM OLD."outputProductId" THEN
    RAISE EXCEPTION 'Recipe % cannot change its output Product after creation.', OLD."id" USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF OLD."status" = 'DRAFT'::"RecipeStatus" AND NEW."status" = 'ACTIVE'::"RecipeStatus" THEN
      IF NOT EXISTS (SELECT 1 FROM "RecipeItem" WHERE "recipeId" = OLD."id") THEN
        RAISE EXCEPTION 'Recipe % requires at least one RecipeItem before activation.', OLD."id" USING ERRCODE = '23514';
      END IF;
    ELSIF OLD."status" = 'ACTIVE'::"RecipeStatus" AND NEW."status" = 'ARCHIVED'::"RecipeStatus" THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Recipe % cannot transition from % to %.', OLD."id", OLD."status", NEW."status" USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."status" <> 'DRAFT'::"RecipeStatus"
    AND (
      NEW."yieldQuantity" IS DISTINCT FROM OLD."yieldQuantity"
      OR NEW."yieldUnitId" IS DISTINCT FROM OLD."yieldUnitId"
      OR NEW."revision" IS DISTINCT FROM OLD."revision"
    ) THEN
    RAISE EXCEPTION 'Recipe % structure can change only while DRAFT.', OLD."id" USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Recipe_enforce_lifecycle_and_structure_trigger"
BEFORE INSERT OR UPDATE ON "Recipe"
FOR EACH ROW
EXECUTE FUNCTION "enforce_recipe_lifecycle_and_structure"();

CREATE FUNCTION "require_draft_recipe_for_item_structure_change"(recipe_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  recipe_status "RecipeStatus";
BEGIN
  SELECT "status"
  INTO recipe_status
  FROM "Recipe"
  WHERE "id" = recipe_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe % must exist before its RecipeItems can change.', recipe_id USING ERRCODE = '23503';
  END IF;

  IF recipe_status <> 'DRAFT'::"RecipeStatus" THEN
    RAISE EXCEPTION 'RecipeItems can change only while Recipe % is DRAFT.', recipe_id USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "enforce_recipe_item_lifecycle"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "require_draft_recipe_for_item_structure_change"(NEW."recipeId");
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM "require_draft_recipe_for_item_structure_change"(OLD."recipeId");
    RETURN OLD;
  END IF;

  IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId"
    OR NEW."productId" IS DISTINCT FROM OLD."productId"
    OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
    OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
    OR NEW."sortOrder" IS DISTINCT FROM OLD."sortOrder" THEN
    PERFORM "require_draft_recipe_for_item_structure_change"(OLD."recipeId");
    IF NEW."recipeId" IS DISTINCT FROM OLD."recipeId" THEN
      PERFORM "require_draft_recipe_for_item_structure_change"(NEW."recipeId");
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "RecipeItem_enforce_lifecycle_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "RecipeItem"
FOR EACH ROW
EXECUTE FUNCTION "enforce_recipe_item_lifecycle"();
