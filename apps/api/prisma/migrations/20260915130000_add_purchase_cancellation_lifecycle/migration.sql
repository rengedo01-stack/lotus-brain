-- C24A keeps cancellation as a terminal business lifecycle. It is deliberately
-- not an inventory or price reversal: only unposted purchases can transition.
ALTER TABLE "Purchase" ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "Purchase"
DROP CONSTRAINT "Purchase_status_timestamps_check";

ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_status_timestamps_check"
CHECK (
  ("status" = 'POSTED'
    AND "postedAt" IS NOT NULL
    AND "cancelledAt" IS NULL
    AND "cancellationReason" IS NULL)
  OR ("status" IN ('DRAFT', 'CONFIRMED')
    AND "postedAt" IS NULL
    AND "cancelledAt" IS NULL
    AND "cancellationReason" IS NULL)
  OR ("status" = 'CANCELLED'
    AND "postedAt" IS NULL
    AND "cancelledAt" IS NOT NULL
    AND "cancellationReason" IS NOT NULL
    AND btrim("cancellationReason") <> ''
    AND char_length("cancellationReason") <= 10000)
);

CREATE FUNCTION "enforce_purchase_lifecycle_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- POSTED and CANCELLED are terminal. updatedAt is framework-managed and may
  -- change only as part of a rejected write, so it is intentionally ignored.
  IF OLD."status" IN ('POSTED', 'CANCELLED') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
      OR NEW."purchaseDate" IS DISTINCT FROM OLD."purchaseDate"
      OR NEW."documentNumber" IS DISTINCT FROM OLD."documentNumber"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
      OR NEW."tax" IS DISTINCT FROM OLD."tax"
      OR NEW."total" IS DISTINCT FROM OLD."total"
      OR NEW."note" IS DISTINCT FROM OLD."note"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
      OR NEW."cancellationReason" IS DISTINCT FROM OLD."cancellationReason"
    THEN
      RAISE EXCEPTION 'Purchase % is terminal and cannot be changed.', OLD."id"
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    -- A lifecycle transition cannot smuggle a header/business-field edit into
    -- the same write. Purchase items are protected separately below.
    IF NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
      OR NEW."purchaseDate" IS DISTINCT FROM OLD."purchaseDate"
      OR NEW."documentNumber" IS DISTINCT FROM OLD."documentNumber"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
      OR NEW."tax" IS DISTINCT FROM OLD."tax"
      OR NEW."total" IS DISTINCT FROM OLD."total"
      OR NEW."note" IS DISTINCT FROM OLD."note"
    THEN
      RAISE EXCEPTION 'Purchase % lifecycle transitions cannot change business fields.', OLD."id"
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('CONFIRMED', 'POSTED', 'CANCELLED'))
      OR (OLD."status" = 'CONFIRMED' AND NEW."status" IN ('POSTED', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Purchase % cannot transition from % to %.', OLD."id", OLD."status", NEW."status"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- CONFIRMED is not editable by existing application semantics. This closes
  -- direct SQL from changing its authoritative header between confirm and post.
  IF OLD."status" = 'CONFIRMED' AND NEW."status" = 'CONFIRMED' THEN
    IF NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
      OR NEW."purchaseDate" IS DISTINCT FROM OLD."purchaseDate"
      OR NEW."documentNumber" IS DISTINCT FROM OLD."documentNumber"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
      OR NEW."tax" IS DISTINCT FROM OLD."tax"
      OR NEW."total" IS DISTINCT FROM OLD."total"
      OR NEW."note" IS DISTINCT FROM OLD."note"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
      OR NEW."cancellationReason" IS DISTINCT FROM OLD."cancellationReason"
    THEN
      RAISE EXCEPTION 'Confirmed Purchase % is not editable.', OLD."id"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Purchase_enforce_lifecycle_transition_trigger"
BEFORE UPDATE ON "Purchase"
FOR EACH ROW
EXECUTE FUNCTION "enforce_purchase_lifecycle_transition"();

CREATE FUNCTION "prevent_non_draft_purchase_item_business_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "PurchaseStatus";
  parent_purchase_id TEXT;
BEGIN
  parent_purchase_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."purchaseId" ELSE NEW."purchaseId" END;
  SELECT "status" INTO parent_status
  FROM "Purchase"
  WHERE "id" = parent_purchase_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase % was not found.', parent_purchase_id USING ERRCODE = '23503';
  END IF;
  IF parent_status = 'DRAFT' THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Posting's existing sourceLockedAt trigger is an audit-only update that
  -- occurs after the parent changes to POSTED. It remains legal; no business
  -- value may change outside DRAFT.
  IF TG_OP = 'UPDATE'
    AND NEW."purchaseId" IS NOT DISTINCT FROM OLD."purchaseId"
    AND NEW."productId" IS NOT DISTINCT FROM OLD."productId"
    AND NEW."unitId" IS NOT DISTINCT FROM OLD."unitId"
    AND NEW."lineNumber" IS NOT DISTINCT FROM OLD."lineNumber"
    AND NEW."quantity" IS NOT DISTINCT FROM OLD."quantity"
    AND NEW."unitPrice" IS NOT DISTINCT FROM OLD."unitPrice"
    AND NEW."lineAmount" IS NOT DISTINCT FROM OLD."lineAmount"
    AND NEW."taxRate" IS NOT DISTINCT FROM OLD."taxRate"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Purchase item business fields can only change while Purchase % is DRAFT.', parent_purchase_id
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PurchaseItem_prevent_non_draft_business_mutation_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_non_draft_purchase_item_business_mutation"();
