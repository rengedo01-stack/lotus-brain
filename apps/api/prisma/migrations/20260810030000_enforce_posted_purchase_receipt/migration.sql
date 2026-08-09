-- CreateFunction
CREATE FUNCTION "require_posted_purchase_receipt"()
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

  -- Lock only the parent Purchase row. FOR SHARE conflicts with concurrent
  -- status updates, so a status change cannot race this receipt write.
  SELECT p."id", p."status"
  INTO parent_purchase_id, parent_purchase_status
  FROM "PurchaseItem" AS pi
  INNER JOIN "Purchase" AS p ON p."id" = pi."purchaseId"
  WHERE pi."id" = NEW."sourcePurchaseItemId"
  FOR SHARE OF p;

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
CREATE TRIGGER "InventoryHistory_require_posted_purchase_receipt_trigger"
BEFORE INSERT OR UPDATE ON "InventoryHistory"
FOR EACH ROW
EXECUTE FUNCTION "require_posted_purchase_receipt"();
