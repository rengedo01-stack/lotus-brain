CREATE FUNCTION "prevent_production_output_source_reassignment"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourceProductionId" IS NOT NULL
    AND NEW."sourceProductionId" IS DISTINCT FROM OLD."sourceProductionId" THEN
    RAISE EXCEPTION 'Production output receipt % cannot be reassigned to another Production.', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryHistory_prevent_production_output_source_reassignment_trigger"
BEFORE UPDATE OF "sourceProductionId" ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "prevent_production_output_source_reassignment"();
