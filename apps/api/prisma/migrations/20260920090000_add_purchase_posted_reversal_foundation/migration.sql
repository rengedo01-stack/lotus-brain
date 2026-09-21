-- C24C-2A adds a correction ledger for already POSTED purchases.  It never
-- rewrites the original purchase or its receipt/price evidence.
ALTER TYPE "InventoryTransactionType" ADD VALUE IF NOT EXISTS 'PURCHASE_REVERSAL';
ALTER TYPE "PurchaseLogEventType" ADD VALUE IF NOT EXISTS 'POSTED_REVERSED';
ALTER TYPE "PriceHistoryEventType" ADD VALUE IF NOT EXISTS 'PURCHASE_REVERSAL';
CREATE TYPE "PurchaseReversalPriceEffectSource" AS ENUM (
  'ORIGINAL_PURCHASE_CURRENT',
  'SUBSEQUENT_PRICE_HISTORY_CURRENT',
  'LEGACY_UNKNOWN_CURRENT'
);

-- The former compound unique constraint made a retained, corrected Purchase
-- permanently reserve its document number.  Claims preserve the same DB-level
-- protection only while active, allowing a successful reversal to release it.
CREATE TABLE "PurchaseDocumentClaim" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "documentNumber" VARCHAR(100) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseDocumentClaim_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Purchase"
    WHERE "documentNumber" IS NOT NULL
    GROUP BY "supplierId", "documentNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate Purchase document claims: duplicate supplier/documentNumber data exists.'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

INSERT INTO "PurchaseDocumentClaim" (
  "id", "purchaseId", "supplierId", "documentNumber", "claimedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-document-claim-' || "id", "id", "supplierId", "documentNumber", "createdAt", "createdAt", "updatedAt"
FROM "Purchase"
WHERE "documentNumber" IS NOT NULL;

ALTER TABLE "PurchaseDocumentClaim"
  ADD CONSTRAINT "PurchaseDocumentClaim_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseDocumentClaim_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PurchaseDocumentClaim_purchaseId_key" ON "PurchaseDocumentClaim"("purchaseId");
CREATE UNIQUE INDEX "PurchaseDocumentClaim_active_supplier_document_key"
  ON "PurchaseDocumentClaim"("supplierId", "documentNumber")
  WHERE "releasedAt" IS NULL;
CREATE INDEX "PurchaseDocumentClaim_supplierId_documentNumber_idx"
  ON "PurchaseDocumentClaim"("supplierId", "documentNumber");
CREATE INDEX "PurchaseDocumentClaim_releasedAt_idx" ON "PurchaseDocumentClaim"("releasedAt");

DROP INDEX "Purchase_supplierId_documentNumber_key";

CREATE TABLE "PurchaseReversal" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(36) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "previewVersion" CHAR(64) NOT NULL,
  "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReversal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReversalItem" (
  "id" TEXT NOT NULL,
  "purchaseReversalId" TEXT NOT NULL,
  "purchaseItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "inventoryUnitId" TEXT NOT NULL,
  "quantity" DECIMAL(24,9) NOT NULL,
  "unitPrice" DECIMAL(20,6) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReversalItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReversalInventoryEffect" (
  "id" TEXT NOT NULL,
  "purchaseReversalId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "inventoryUnitId" TEXT NOT NULL,
  "quantityDelta" DECIMAL(24,9) NOT NULL,
  "quantityAfter" DECIMAL(24,9) NOT NULL,
  "averageUnitCost" DECIMAL(20,6),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReversalInventoryEffect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReversalPriceEffect" (
  "id" TEXT NOT NULL,
  "purchaseReversalId" TEXT NOT NULL,
  "priceMasterId" TEXT NOT NULL,
  "source" "PurchaseReversalPriceEffectSource" NOT NULL,
  "previousCurrentPriceHistoryId" TEXT,
  "previousVersion" INTEGER NOT NULL,
  "appliedUnitPrice" DECIMAL(20,6) NOT NULL,
  "appliedCurrency" CHAR(3) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "becomesCurrent" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReversalPriceEffect_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryHistory"
  ADD COLUMN "sourcePurchaseReversalInventoryEffectId" TEXT;
ALTER TABLE "PriceHistory"
  ADD COLUMN "sourcePurchaseReversalPriceEffectId" TEXT;
ALTER TABLE "PurchaseLog"
  ADD COLUMN "sourcePurchaseReversalId" TEXT;

CREATE UNIQUE INDEX "PurchaseReversal_purchaseId_key" ON "PurchaseReversal"("purchaseId");
CREATE UNIQUE INDEX "PurchaseReversal_idempotencyKey_key" ON "PurchaseReversal"("idempotencyKey");
CREATE INDEX "PurchaseReversal_actorUserId_reversedAt_idx" ON "PurchaseReversal"("actorUserId", "reversedAt");
CREATE UNIQUE INDEX "PurchaseReversalItem_purchaseItemId_key" ON "PurchaseReversalItem"("purchaseItemId");
CREATE UNIQUE INDEX "PurchaseReversalItem_purchaseReversalId_purchaseItemId_key" ON "PurchaseReversalItem"("purchaseReversalId", "purchaseItemId");
CREATE INDEX "PurchaseReversalItem_purchaseReversalId_productId_idx" ON "PurchaseReversalItem"("purchaseReversalId", "productId");
CREATE INDEX "PurchaseReversalItem_productId_idx" ON "PurchaseReversalItem"("productId");
CREATE UNIQUE INDEX "PurchaseReversalInventoryEffect_purchaseReversalId_productId_key" ON "PurchaseReversalInventoryEffect"("purchaseReversalId", "productId");
CREATE INDEX "PurchaseReversalInventoryEffect_inventoryId_idx" ON "PurchaseReversalInventoryEffect"("inventoryId");
CREATE UNIQUE INDEX "PurchaseReversalPriceEffect_purchaseReversalId_priceMasterId_key" ON "PurchaseReversalPriceEffect"("purchaseReversalId", "priceMasterId");
CREATE INDEX "PurchaseReversalPriceEffect_priceMasterId_idx" ON "PurchaseReversalPriceEffect"("priceMasterId");
CREATE UNIQUE INDEX "InventoryHistory_sourcePurchaseReversalInventoryEffectId_key" ON "InventoryHistory"("sourcePurchaseReversalInventoryEffectId");
CREATE UNIQUE INDEX "PriceHistory_sourcePurchaseReversalPriceEffectId_key" ON "PriceHistory"("sourcePurchaseReversalPriceEffectId");
CREATE UNIQUE INDEX "PurchaseLog_sourcePurchaseReversalId_key" ON "PurchaseLog"("sourcePurchaseReversalId");

ALTER TABLE "PurchaseReversal"
  ADD CONSTRAINT "PurchaseReversal_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversal_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReversalItem"
  ADD CONSTRAINT "PurchaseReversalItem_purchaseReversalId_fkey"
    FOREIGN KEY ("purchaseReversalId") REFERENCES "PurchaseReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalItem_purchaseItemId_fkey"
    FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalItem_inventoryUnitId_fkey"
    FOREIGN KEY ("inventoryUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReversalInventoryEffect"
  ADD CONSTRAINT "PurchaseReversalInventoryEffect_purchaseReversalId_fkey"
    FOREIGN KEY ("purchaseReversalId") REFERENCES "PurchaseReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalInventoryEffect_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalInventoryEffect_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalInventoryEffect_inventoryUnitId_fkey"
    FOREIGN KEY ("inventoryUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReversalPriceEffect"
  ADD CONSTRAINT "PurchaseReversalPriceEffect_purchaseReversalId_fkey"
    FOREIGN KEY ("purchaseReversalId") REFERENCES "PurchaseReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReversalPriceEffect_priceMasterId_fkey"
    FOREIGN KEY ("priceMasterId") REFERENCES "PriceMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryHistory"
  ADD CONSTRAINT "InventoryHistory_sourcePurchaseReversalInventoryEffectId_fkey"
    FOREIGN KEY ("sourcePurchaseReversalInventoryEffectId") REFERENCES "PurchaseReversalInventoryEffect"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryHistory_purchase_reversal_source_type_check"
    CHECK ("sourcePurchaseReversalInventoryEffectId" IS NULL OR "type"::text = 'PURCHASE_REVERSAL');
ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_sourcePurchaseReversalPriceEffectId_fkey"
    FOREIGN KEY ("sourcePurchaseReversalPriceEffectId") REFERENCES "PurchaseReversalPriceEffect"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseLog"
  ADD CONSTRAINT "PurchaseLog_sourcePurchaseReversalId_fkey"
    FOREIGN KEY ("sourcePurchaseReversalId") REFERENCES "PurchaseReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "sync_purchase_document_claim"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."documentNumber" IS NULL THEN
    UPDATE "PurchaseDocumentClaim"
    SET "releasedAt" = COALESCE("releasedAt", CURRENT_TIMESTAMP), "updatedAt" = CURRENT_TIMESTAMP
    WHERE "purchaseId" = NEW."id" AND "releasedAt" IS NULL;
    RETURN NEW;
  END IF;

  INSERT INTO "PurchaseDocumentClaim" (
    "id", "purchaseId", "supplierId", "documentNumber", "claimedAt", "createdAt", "updatedAt"
  ) VALUES (
    'document-claim-' || NEW."id", NEW."id", NEW."supplierId", NEW."documentNumber", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("purchaseId") DO UPDATE
  SET
    "supplierId" = EXCLUDED."supplierId",
    "documentNumber" = EXCLUDED."documentNumber",
    "releasedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "validate_purchase_document_claim"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_supplier_id TEXT;
  purchase_document_number TEXT;
  purchase_status "PurchaseStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase document claims cannot be deleted.' USING ERRCODE = '23514';
  END IF;

  SELECT "supplierId", "documentNumber", "status"
  INTO purchase_supplier_id, purchase_document_number, purchase_status
  FROM "Purchase"
  WHERE "id" = NEW."purchaseId"
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase document claim % must reference an existing Purchase.', NEW."id" USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."purchaseId" IS DISTINCT FROM OLD."purchaseId" THEN
    RAISE EXCEPTION 'Purchase document claim % cannot be reassigned.', OLD."id" USING ERRCODE = '23514';
  END IF;

  IF NEW."releasedAt" IS NULL
    AND (NEW."supplierId" IS DISTINCT FROM purchase_supplier_id OR NEW."documentNumber" IS DISTINCT FROM purchase_document_number) THEN
    RAISE EXCEPTION 'Active purchase document claim % must match its Purchase.', NEW."id" USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase document claim % must begin active.', NEW."id" USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "PurchaseReversal" WHERE "purchaseId" = NEW."purchaseId")
      AND NOT (purchase_status = 'DRAFT'::"PurchaseStatus" AND purchase_document_number IS NULL) THEN
      RAISE EXCEPTION 'Purchase document claim % may be released only by a posted reversal or removal from a DRAFT.', OLD."id" USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS NULL
    AND purchase_status <> 'DRAFT'::"PurchaseStatus" THEN
    RAISE EXCEPTION 'Released purchase document claim % cannot be reactivated after DRAFT.', OLD."id" USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS NOT NULL
    AND (NEW."supplierId" IS DISTINCT FROM OLD."supplierId" OR NEW."documentNumber" IS DISTINCT FROM OLD."documentNumber" OR NEW."claimedAt" IS DISTINCT FROM OLD."claimedAt") THEN
    RAISE EXCEPTION 'Released purchase document claim % is immutable.', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PurchaseDocumentClaim_validate_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseDocumentClaim"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_document_claim"();

CREATE TRIGGER "Purchase_sync_document_claim_trigger"
AFTER INSERT OR UPDATE OF "supplierId", "documentNumber" ON "Purchase"
FOR EACH ROW EXECUTE FUNCTION "sync_purchase_document_claim"();

CREATE FUNCTION "assert_purchase_reversal_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_status "PurchaseStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase reversal % is immutable.', OLD."id" USING ERRCODE = '23514';
  END IF;
  SELECT "status" INTO purchase_status FROM "Purchase" WHERE "id" = NEW."purchaseId" FOR KEY SHARE;
  IF NOT FOUND OR purchase_status <> 'POSTED'::"PurchaseStatus" THEN
    RAISE EXCEPTION 'Purchase reversal % requires a POSTED Purchase.', NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PurchaseReversal_append_only_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReversal"
FOR EACH ROW EXECUTE FUNCTION "assert_purchase_reversal_insert"();

CREATE FUNCTION "validate_purchase_reversal_item"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reversal_purchase_id TEXT;
  item_purchase_id TEXT;
  item_product_id TEXT;
  item_unit_id TEXT;
  item_quantity NUMERIC;
  item_unit_price NUMERIC;
  purchase_currency CHAR(3);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase reversal item % is immutable.', OLD."id" USING ERRCODE = '23514';
  END IF;
  SELECT pr."purchaseId", pi."purchaseId", pi."productId", pi."unitId", pi."quantity", pi."unitPrice", p."currency"
  INTO reversal_purchase_id, item_purchase_id, item_product_id, item_unit_id, item_quantity, item_unit_price, purchase_currency
  FROM "PurchaseReversal" pr
  INNER JOIN "PurchaseItem" pi ON pi."id" = NEW."purchaseItemId"
  INNER JOIN "Purchase" p ON p."id" = pi."purchaseId"
  WHERE pr."id" = NEW."purchaseReversalId"
  FOR KEY SHARE OF pr, pi, p;
  IF NOT FOUND
    OR reversal_purchase_id <> item_purchase_id
    OR NEW."productId" <> item_product_id
    OR NEW."inventoryUnitId" <> item_unit_id
    OR NEW."quantity" <> item_quantity
    OR NEW."unitPrice" <> item_unit_price
    OR NEW."currency" <> purchase_currency THEN
    RAISE EXCEPTION 'Purchase reversal item % must be an exact item snapshot of its reversed Purchase.', NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PurchaseReversalItem_append_only_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReversalItem"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_item"();

CREATE FUNCTION "validate_purchase_reversal_inventory_effect"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_quantity NUMERIC;
  inventory_product_id TEXT;
  product_inventory_unit_id TEXT;
  current_inventory_quantity NUMERIC;
BEGIN
  SELECT COALESCE(SUM("quantity"), 0)
  INTO expected_quantity
  FROM "PurchaseReversalItem"
  WHERE "purchaseReversalId" = NEW."purchaseReversalId" AND "productId" = NEW."productId";
  SELECT i."productId", p."inventoryUnitId", i."quantity"
  INTO inventory_product_id, product_inventory_unit_id, current_inventory_quantity
  FROM "Inventory" i INNER JOIN "Product" p ON p."id" = i."productId"
  WHERE i."id" = NEW."inventoryId"
  FOR KEY SHARE OF i, p;
  IF NOT FOUND
    OR inventory_product_id <> NEW."productId"
    OR product_inventory_unit_id <> NEW."inventoryUnitId"
    OR NEW."quantityDelta" <> -expected_quantity
    OR NEW."quantityDelta" >= 0
    OR NEW."quantityAfter" <> current_inventory_quantity THEN
    RAISE EXCEPTION 'Purchase reversal inventory effect % is not a valid current-stock aggregate.', NEW."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PurchaseReversalInventoryEffect_validate_trigger"
AFTER INSERT ON "PurchaseReversalInventoryEffect"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_inventory_effect"();

CREATE FUNCTION "prevent_purchase_reversal_inventory_effect_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Purchase reversal inventory effect % is append-only and cannot be %.', OLD."id", TG_OP USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PurchaseReversalInventoryEffect_append_only_trigger"
BEFORE UPDATE OR DELETE ON "PurchaseReversalInventoryEffect"
FOR EACH ROW EXECUTE FUNCTION "prevent_purchase_reversal_inventory_effect_mutation"();

CREATE FUNCTION "validate_purchase_reversal_price_effect"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reversal_purchase_id TEXT;
  current_history_id TEXT;
  current_version INTEGER;
  current_unit_price NUMERIC;
  current_currency CHAR(3);
  current_is_original BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase reversal price effect % is immutable.', OLD."id" USING ERRCODE = '23514';
  END IF;
  SELECT pr."purchaseId", pm."currentPriceHistoryId", pm."version", pm."currentUnitPrice", pm."currency"
  INTO reversal_purchase_id, current_history_id, current_version, current_unit_price, current_currency
  FROM "PurchaseReversal" pr CROSS JOIN "PriceMaster" pm
  WHERE pr."id" = NEW."purchaseReversalId" AND pm."id" = NEW."priceMasterId"
  FOR KEY SHARE OF pr, pm;
  IF NOT FOUND OR NEW."previousCurrentPriceHistoryId" IS DISTINCT FROM current_history_id OR NEW."previousVersion" <> current_version THEN
    RAISE EXCEPTION 'Purchase reversal price effect % must snapshot the locked PriceMaster current state.', NEW."id" USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM "PriceHistory" ph
    INNER JOIN "PurchaseItem" pi ON pi."id" = ph."sourcePurchaseItemId"
    WHERE ph."id" = current_history_id AND pi."purchaseId" = reversal_purchase_id
  ) INTO current_is_original;

  IF NEW."source"::text = 'ORIGINAL_PURCHASE_CURRENT' THEN
    IF current_history_id IS NULL OR NOT current_is_original OR NOT NEW."becomesCurrent" THEN
      RAISE EXCEPTION 'Purchase reversal price effect % misclassifies an original current source.', NEW."id" USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."source"::text = 'LEGACY_UNKNOWN_CURRENT' THEN
    IF current_history_id IS NOT NULL OR NOT NEW."becomesCurrent" THEN
      RAISE EXCEPTION 'Purchase reversal price effect % misclassifies a legacy current source.', NEW."id" USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."source"::text = 'SUBSEQUENT_PRICE_HISTORY_CURRENT' THEN
    IF current_history_id IS NULL OR current_is_original OR NEW."becomesCurrent"
      OR NEW."appliedUnitPrice" <> current_unit_price OR NEW."appliedCurrency" <> current_currency THEN
      RAISE EXCEPTION 'Purchase reversal price effect % must preserve a subsequent current source.', NEW."id" USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown purchase reversal price effect source.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PurchaseReversalPriceEffect_append_only_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseReversalPriceEffect"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_price_effect"();

CREATE FUNCTION "validate_purchase_reversal_price_history_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  effect_price_master_id TEXT;
  effect_price NUMERIC;
  effect_currency CHAR(3);
  effect_effective_at TIMESTAMP(3);
BEGIN
  IF NEW."eventType"::text = 'PURCHASE_REVERSAL' AND NEW."sourcePurchaseReversalPriceEffectId" IS NULL THEN
    RAISE EXCEPTION 'PURCHASE_REVERSAL PriceHistory requires a reversal price effect source.' USING ERRCODE = '23514';
  END IF;
  IF NEW."sourcePurchaseReversalPriceEffectId" IS NULL THEN RETURN NEW; END IF;
  SELECT "priceMasterId", "appliedUnitPrice", "appliedCurrency", "effectiveAt"
  INTO effect_price_master_id, effect_price, effect_currency, effect_effective_at
  FROM "PurchaseReversalPriceEffect"
  WHERE "id" = NEW."sourcePurchaseReversalPriceEffectId"
  FOR KEY SHARE;
  IF NOT FOUND
    OR NEW."eventType"::text <> 'PURCHASE_REVERSAL'
    OR NEW."priceMasterId" <> effect_price_master_id
    OR NEW."unitPrice" <> effect_price
    OR NEW."currency" <> effect_currency
    OR NEW."effectiveAt" <> effect_effective_at THEN
    RAISE EXCEPTION 'Purchase reversal PriceHistory must exactly match its reversal price effect.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PriceHistory_validate_purchase_reversal_source_trigger"
BEFORE INSERT OR UPDATE OF "sourcePurchaseReversalPriceEffectId" ON "PriceHistory"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_price_history_source"();

CREATE FUNCTION "validate_purchase_reversal_inventory_history_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  effect_inventory_id TEXT;
  effect_unit_id TEXT;
  effect_delta NUMERIC;
  effect_after NUMERIC;
BEGIN
  IF NEW."sourcePurchaseReversalInventoryEffectId" IS NULL THEN RETURN NEW; END IF;
  SELECT "inventoryId", "inventoryUnitId", "quantityDelta", "quantityAfter"
  INTO effect_inventory_id, effect_unit_id, effect_delta, effect_after
  FROM "PurchaseReversalInventoryEffect"
  WHERE "id" = NEW."sourcePurchaseReversalInventoryEffectId"
  FOR KEY SHARE;
  IF NOT FOUND
    OR NEW."type"::text <> 'PURCHASE_REVERSAL'
    OR NEW."sourcePurchaseItemId" IS NOT NULL
    OR NEW."inventoryId" <> effect_inventory_id
    OR NEW."inventoryUnitId" <> effect_unit_id
    OR NEW."quantityDelta" <> effect_delta
    OR NEW."quantityAfter" <> effect_after THEN
    RAISE EXCEPTION 'Purchase reversal InventoryHistory must exactly match its reversal inventory effect.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryHistory_validate_purchase_reversal_source_trigger"
BEFORE INSERT OR UPDATE OF "sourcePurchaseReversalInventoryEffectId" ON "InventoryHistory"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_inventory_history_source"();

CREATE FUNCTION "prevent_purchase_reversal_inventory_history_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourcePurchaseReversalInventoryEffectId" IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase reversal InventoryHistory % is append-only and cannot be %.', OLD."id", TG_OP USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "InventoryHistory_prevent_purchase_reversal_mutation_trigger"
BEFORE UPDATE OR DELETE ON "InventoryHistory"
FOR EACH ROW EXECUTE FUNCTION "prevent_purchase_reversal_inventory_history_mutation"();

CREATE FUNCTION "validate_purchase_reversal_log_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reversal_purchase_id TEXT;
BEGIN
  IF NEW."eventType"::text = 'POSTED_REVERSED' AND NEW."sourcePurchaseReversalId" IS NULL THEN
    RAISE EXCEPTION 'POSTED_REVERSED PurchaseLog requires a reversal source.' USING ERRCODE = '23514';
  END IF;
  IF NEW."sourcePurchaseReversalId" IS NULL THEN RETURN NEW; END IF;
  SELECT "purchaseId" INTO reversal_purchase_id FROM "PurchaseReversal" WHERE "id" = NEW."sourcePurchaseReversalId" FOR KEY SHARE;
  IF NOT FOUND OR NEW."eventType"::text <> 'POSTED_REVERSED' OR NEW."purchaseId" <> reversal_purchase_id
    OR NEW."fromStatus" <> 'POSTED'::"PurchaseStatus" OR NEW."toStatus" <> 'POSTED'::"PurchaseStatus" THEN
    RAISE EXCEPTION 'Purchase reversal log must be attached to its POSTED source Purchase.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PurchaseLog_validate_purchase_reversal_source_trigger"
BEFORE INSERT OR UPDATE OF "sourcePurchaseReversalId" ON "PurchaseLog"
FOR EACH ROW EXECUTE FUNCTION "validate_purchase_reversal_log_source"();

CREATE FUNCTION "prevent_purchase_reversal_log_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."sourcePurchaseReversalId" IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase reversal PurchaseLog % is append-only and cannot be %.', OLD."id", TG_OP USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "PurchaseLog_prevent_purchase_reversal_mutation_trigger"
BEFORE UPDATE OR DELETE ON "PurchaseLog"
FOR EACH ROW EXECUTE FUNCTION "prevent_purchase_reversal_log_mutation"();

-- Only system administrators receive the high-risk correction permission by
-- default.  Existing custom roles are intentionally untouched.
INSERT INTO "Permission" ("id", "code", "description")
VALUES ('purchase-reverse-posted-permission', 'purchase.reversePosted', 'Reverse an already posted purchase as a correction.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT 'rbac-role-system-admin', "id" FROM "Permission" WHERE "code" = 'purchase.reversePosted'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
