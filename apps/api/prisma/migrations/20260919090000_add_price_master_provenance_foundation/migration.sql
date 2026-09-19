-- C24C-1 deliberately does not infer which historical row produced an
-- existing PriceMaster.  Existing histories remain intact and are explicitly
-- marked LEGACY_UNKNOWN; only future posting writes establish provenance.
CREATE TYPE "PriceHistoryEventType" AS ENUM ('LEGACY_UNKNOWN', 'PURCHASE_POSTING');

ALTER TABLE "PriceMaster"
  ADD COLUMN "currentPriceHistoryId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PriceHistory"
  ADD COLUMN "eventType" "PriceHistoryEventType";

UPDATE "PriceHistory"
SET "eventType" = 'LEGACY_UNKNOWN'::"PriceHistoryEventType"
WHERE "eventType" IS NULL;

ALTER TABLE "PriceHistory"
  ALTER COLUMN "eventType" SET NOT NULL;

CREATE UNIQUE INDEX "PriceMaster_currentPriceHistoryId_key"
  ON "PriceMaster"("currentPriceHistoryId");

CREATE INDEX "PriceHistory_priceMasterId_eventType_effectiveAt_idx"
  ON "PriceHistory"("priceMasterId", "eventType", "effectiveAt");

ALTER TABLE "PriceMaster"
  ADD CONSTRAINT "PriceMaster_version_positive_check"
  CHECK ("version" >= 1),
  ADD CONSTRAINT "PriceMaster_currentPriceHistoryId_fkey"
  FOREIGN KEY ("currentPriceHistoryId") REFERENCES "PriceHistory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Historical price records are business evidence.  C24C-1 has only two event
-- types, but no update/delete is permitted for either type.
CREATE FUNCTION "prevent_price_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Price history % is append-only and cannot be %.', OLD."id", TG_OP
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PriceHistory_prevent_mutation_trigger"
BEFORE UPDATE OR DELETE ON "PriceHistory"
FOR EACH ROW
EXECUTE FUNCTION "prevent_price_history_mutation"();

-- PriceMaster identifies a durable Product / Supplier pair.  Its mutable
-- current state must advance exactly one optimistic-concurrency revision on
-- each meaningful change; identity reassignment is never allowed.
CREATE FUNCTION "validate_price_master_version"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'PriceMaster % must begin at version 1.', NEW."id"
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."productId" IS DISTINCT FROM OLD."productId"
    OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId" THEN
    RAISE EXCEPTION 'PriceMaster % Product and Supplier identity are immutable.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'PriceMaster % version must increment exactly once.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."currentPriceHistoryId" IS NOT DISTINCT FROM OLD."currentPriceHistoryId"
    AND NEW."currentUnitPrice" IS NOT DISTINCT FROM OLD."currentUnitPrice"
    AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
    AND NEW."currentPriceEffectiveAt" IS NOT DISTINCT FROM OLD."currentPriceEffectiveAt"
    AND NEW."status" IS NOT DISTINCT FROM OLD."status"
    AND NEW."deletedAt" IS NOT DISTINCT FROM OLD."deletedAt" THEN
    RAISE EXCEPTION 'PriceMaster % version may advance only with a current-state change.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PriceMaster_validate_version_trigger"
BEFORE INSERT OR UPDATE ON "PriceMaster"
FOR EACH ROW
EXECUTE FUNCTION "validate_price_master_version"();

-- A source link is valid only when it is a history record owned by the same
-- PriceMaster and its immutable price snapshot exactly matches the current
-- price fields.  It is deferred so the first posting can atomically insert the
-- mutually-referencing PriceMaster and PriceHistory rows in one transaction.
CREATE FUNCTION "validate_price_master_current_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_price_master_id TEXT;
  source_unit_price NUMERIC;
  source_currency TEXT;
  source_effective_at TIMESTAMP(3);
BEGIN
  IF NEW."currentPriceHistoryId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ph."priceMasterId", ph."unitPrice", ph."currency", ph."effectiveAt"
  INTO source_price_master_id, source_unit_price, source_currency, source_effective_at
  FROM "PriceHistory" AS ph
  WHERE ph."id" = NEW."currentPriceHistoryId"
  FOR KEY SHARE;

  IF NOT FOUND OR source_price_master_id <> NEW."id" THEN
    RAISE EXCEPTION 'PriceMaster % current source must belong to the same PriceMaster.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  IF source_unit_price <> NEW."currentUnitPrice"
    OR source_currency <> NEW."currency"
    OR source_effective_at <> NEW."currentPriceEffectiveAt" THEN
    RAISE EXCEPTION 'PriceMaster % current source must match its current price snapshot.', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PriceMaster_validate_current_history_trigger"
AFTER INSERT OR UPDATE ON "PriceMaster"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_price_master_current_history"();
