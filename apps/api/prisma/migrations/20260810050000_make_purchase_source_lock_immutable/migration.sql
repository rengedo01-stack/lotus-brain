-- ReplaceFunction
-- sourceLockedAt is a database-managed audit marker. Once a history record has
-- used a purchase item as its source, no caller may clear or rewrite the marker.
CREATE OR REPLACE FUNCTION "prevent_purchase_item_source_unlock"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourceLockedAt" IS NOT NULL
    AND NEW."sourceLockedAt" IS DISTINCT FROM OLD."sourceLockedAt" THEN
    RAISE EXCEPTION 'Purchase item % cannot change sourceLockedAt once history has referenced it.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
