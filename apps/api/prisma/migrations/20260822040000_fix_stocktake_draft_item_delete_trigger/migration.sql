CREATE OR REPLACE FUNCTION "prevent_stocktake_item_mutation_after_confirmation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "StocktakeStatus";
BEGIN
  SELECT s."status"
  INTO parent_status
  FROM "Stocktake" AS s
  WHERE s."id" = OLD."stocktakeId"
  FOR SHARE;

  IF parent_status <> 'DRAFT'::"StocktakeStatus" THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Stocktake item % cannot be removed after Stocktake % is %.', OLD."id", OLD."stocktakeId", parent_status USING ERRCODE = '23514';
    END IF;

    IF NEW."stocktakeId" IS DISTINCT FROM OLD."stocktakeId"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."inventoryUnitId" IS DISTINCT FROM OLD."inventoryUnitId"
      OR NEW."systemQuantitySnapshot" IS DISTINCT FROM OLD."systemQuantitySnapshot"
      OR NEW."countedQuantity" IS DISTINCT FROM OLD."countedQuantity"
      OR NEW."differenceQuantity" IS DISTINCT FROM OLD."differenceQuantity"
      OR NEW."note" IS DISTINCT FROM OLD."note" THEN
      RAISE EXCEPTION 'Stocktake item % cannot change after Stocktake % is %.', OLD."id", OLD."stocktakeId", parent_status USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
