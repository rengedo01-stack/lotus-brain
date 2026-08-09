-- AlterTable
ALTER TABLE "PurchaseItem" ADD COLUMN "sourceLockedAt" TIMESTAMP(3);

-- Backfill source locks before parent reassignment becomes restricted.
UPDATE "PurchaseItem" AS pi
SET
  "sourceLockedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "InventoryHistory" AS ih
  WHERE ih."sourcePurchaseItemId" = pi."id"
)
OR EXISTS (
  SELECT 1
  FROM "PriceHistory" AS ph
  WHERE ph."sourcePurchaseItemId" = pi."id"
);

-- CreateFunction
CREATE FUNCTION "mark_purchase_item_source_locked"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."sourcePurchaseItemId" IS NULL
    OR (TG_OP = 'UPDATE' AND NEW."sourcePurchaseItemId" IS NOT DISTINCT FROM OLD."sourcePurchaseItemId") THEN
    RETURN NEW;
  END IF;

  -- Lock the source item with a physical row update. A concurrent parent
  -- reassignment must wait, then observes sourceLockedAt on the new row version.
  UPDATE "PurchaseItem"
  SET
    "sourceLockedAt" = COALESCE("sourceLockedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = NEW."sourcePurchaseItemId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase item % was not found.', NEW."sourcePurchaseItemId"
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateFunction
CREATE FUNCTION "prevent_sourced_purchase_item_reassignment"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."purchaseId" IS NOT DISTINCT FROM OLD."purchaseId" THEN
    RETURN NEW;
  END IF;

  -- sourceLockedAt closes the concurrent path; EXISTS also protects records
  -- created before this migration if a backfill was ever incomplete.
  IF OLD."sourceLockedAt" IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM "InventoryHistory" AS ih
      WHERE ih."sourcePurchaseItemId" = OLD."id"
    )
    OR EXISTS (
      SELECT 1
      FROM "PriceHistory" AS ph
      WHERE ph."sourcePurchaseItemId" = OLD."id"
    ) THEN
    RAISE EXCEPTION 'Purchase item % cannot be reassigned after it is used as a history source.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateFunction
CREATE FUNCTION "prevent_purchase_item_source_unlock"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourceLockedAt" IS NOT NULL AND NEW."sourceLockedAt" IS NULL THEN
    RAISE EXCEPTION 'Purchase item % cannot clear sourceLockedAt once history has referenced it.', OLD."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ReplaceFunction
CREATE OR REPLACE FUNCTION "require_posted_purchase_receipt"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_purchase_id TEXT;
  parent_purchase_status "PurchaseStatus";
BEGIN
  IF NEW."sourcePurchaseItemId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Keep the runtime lock order consistent: source PurchaseItem, then parent
  -- Purchase. NO KEY UPDATE conflicts with parent reassignment; SHARE protects
  -- the parent status from a concurrent status update until this write commits.
  SELECT p."id", p."status"
  INTO parent_purchase_id, parent_purchase_status
  FROM "PurchaseItem" AS pi
  INNER JOIN "Purchase" AS p ON p."id" = pi."purchaseId"
  WHERE pi."id" = NEW."sourcePurchaseItemId"
  FOR NO KEY UPDATE OF pi FOR SHARE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase item % must belong to an existing purchase.', NEW."sourcePurchaseItemId"
      USING ERRCODE = '23503';
  END IF;

  IF parent_purchase_status <> 'POSTED'::"PurchaseStatus" THEN
    RAISE EXCEPTION 'Purchase % must be POSTED before a receipt inventory history can be written; current status is %.', parent_purchase_id, parent_purchase_status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- CreateTrigger
CREATE TRIGGER "InventoryHistory_lock_purchase_item_source_trigger"
BEFORE INSERT OR UPDATE OF "sourcePurchaseItemId" ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "mark_purchase_item_source_locked"();

-- CreateTrigger
CREATE TRIGGER "PriceHistory_lock_purchase_item_source_trigger"
BEFORE INSERT OR UPDATE OF "sourcePurchaseItemId" ON "PriceHistory"
FOR EACH ROW
EXECUTE FUNCTION "mark_purchase_item_source_locked"();

-- CreateTrigger
CREATE TRIGGER "PurchaseItem_prevent_sourced_reassignment_trigger"
BEFORE UPDATE OF "purchaseId" ON "PurchaseItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sourced_purchase_item_reassignment"();

-- CreateTrigger
CREATE TRIGGER "PurchaseItem_prevent_source_unlock_trigger"
BEFORE UPDATE OF "sourceLockedAt" ON "PurchaseItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_purchase_item_source_unlock"();
