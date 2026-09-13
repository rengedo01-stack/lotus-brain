-- One immutable, per-PurchaseItem provenance artifact is the idempotency
-- boundary for a future Recommendation-to-Purchase handoff.  Current master
-- records are deliberately represented by scalar snapshots: commercial terms
-- may be cleared and a historical handoff must never block that operation.
CREATE TABLE "RecommendationPurchaseHandoff" (
  "id" TEXT NOT NULL,
  "sourceRecommendationId" TEXT NOT NULL,
  "purchaseItemId" TEXT NOT NULL,
  "sourceRelationshipId" TEXT NOT NULL,
  "sourceSupplierId" TEXT NOT NULL,
  "sourceRecommendedQuantity" DECIMAL(24,9) NOT NULL,
  "sourceRecommendationVersion" INTEGER NOT NULL,
  "sourceCalculationPolicyVersion" INTEGER NOT NULL,
  "sourcePackageId" TEXT,
  "sourcePackageCode" TEXT,
  "sourcePackageQuantity" DECIMAL(24,9),
  "sourcePackageVersion" INTEGER,
  "sourceCommercialTermsId" TEXT NOT NULL,
  "sourceCommercialTermsVersion" INTEGER NOT NULL,
  "sourceUnitPrice" DECIMAL(20,6) NOT NULL,
  "sourceCurrencyCode" CHAR(3) NOT NULL,
  "sourceTaxRate" DECIMAL(5,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecommendationPurchaseHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecommendationPurchaseHandoff_source_recommended_quantity_check"
    CHECK ("sourceRecommendedQuantity" > 0),
  CONSTRAINT "RecommendationPurchaseHandoff_source_recommendation_version_check"
    CHECK ("sourceRecommendationVersion" > 0),
  CONSTRAINT "RecommendationPurchaseHandoff_calculation_policy_version_check"
    CHECK ("sourceCalculationPolicyVersion" > 0),
  CONSTRAINT "RecommendationPurchaseHandoff_package_snapshot_check"
    CHECK (
      ("sourcePackageId" IS NULL
        AND "sourcePackageCode" IS NULL
        AND "sourcePackageQuantity" IS NULL
        AND "sourcePackageVersion" IS NULL)
      OR
      ("sourcePackageId" IS NOT NULL
        AND "sourcePackageCode" IS NOT NULL
        AND "sourcePackageQuantity" > 0
        AND "sourcePackageVersion" > 0)
    ),
  CONSTRAINT "RecommendationPurchaseHandoff_commercial_terms_version_check"
    CHECK ("sourceCommercialTermsVersion" > 0),
  CONSTRAINT "RecommendationPurchaseHandoff_commercial_amount_check"
    CHECK ("sourceUnitPrice" >= 0 AND "sourceTaxRate" >= 0 AND "sourceTaxRate" <= 1),
  CONSTRAINT "RecommendationPurchaseHandoff_currency_check"
    CHECK ("sourceCurrencyCode" = 'JPY')
);

CREATE UNIQUE INDEX "RecommendationPurchaseHandoff_sourceRecommendationId_key"
ON "RecommendationPurchaseHandoff"("sourceRecommendationId");

CREATE UNIQUE INDEX "RecommendationPurchaseHandoff_purchaseItemId_key"
ON "RecommendationPurchaseHandoff"("purchaseItemId");

ALTER TABLE "RecommendationPurchaseHandoff"
  ADD CONSTRAINT "RecommendationPurchaseHandoff_sourceRecommendationId_fkey"
  FOREIGN KEY ("sourceRecommendationId") REFERENCES "ReplenishmentRecommendation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecommendationPurchaseHandoff"
  ADD CONSTRAINT "RecommendationPurchaseHandoff_purchaseItemId_fkey"
  FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot rows are append-only.  Recommendation lifecycle remains on the
-- source recommendation; this artifact never changes after a handoff commits.
CREATE FUNCTION "prevent_recommendation_purchase_handoff_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Recommendation purchase handoff % is immutable.', OLD."id"
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "RecommendationPurchaseHandoff_prevent_mutation_trigger"
BEFORE UPDATE OR DELETE ON "RecommendationPurchaseHandoff"
FOR EACH ROW
EXECUTE FUNCTION "prevent_recommendation_purchase_handoff_mutation"();

-- A handoff-created line cannot be repurposed or altered while its provenance
-- advertises a Recommendation-derived commercial decision.  This leaves
-- manual PurchaseItems completely unchanged.
CREATE FUNCTION "prevent_handoff_purchase_item_business_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "RecommendationPurchaseHandoff" AS handoff
    WHERE handoff."purchaseItemId" = OLD."id"
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Purchase item % is fixed by immutable Recommendation handoff provenance.', OLD."id"
        USING ERRCODE = '23514';
    END IF;

    IF NEW."purchaseId" IS DISTINCT FROM OLD."purchaseId"
      OR NEW."productId" IS DISTINCT FROM OLD."productId"
      OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
      OR NEW."lineNumber" IS DISTINCT FROM OLD."lineNumber"
      OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
      OR NEW."unitPrice" IS DISTINCT FROM OLD."unitPrice"
      OR NEW."lineAmount" IS DISTINCT FROM OLD."lineAmount"
      OR NEW."taxRate" IS DISTINCT FROM OLD."taxRate"
    THEN
      RAISE EXCEPTION 'Purchase item % is fixed by immutable Recommendation handoff provenance.', OLD."id"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "PurchaseItem_prevent_handoff_business_mutation_trigger"
BEFORE UPDATE OR DELETE ON "PurchaseItem"
FOR EACH ROW
EXECUTE FUNCTION "prevent_handoff_purchase_item_business_mutation"();

-- Supplier and currency are Purchase-level authoritative facts for every
-- derived line. Metadata such as note and documentNumber remain editable.
CREATE FUNCTION "prevent_handoff_purchase_commercial_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW."supplierId" IS DISTINCT FROM OLD."supplierId"
      OR NEW."currency" IS DISTINCT FROM OLD."currency")
    AND EXISTS (
      SELECT 1
      FROM "PurchaseItem" AS item
      INNER JOIN "RecommendationPurchaseHandoff" AS handoff ON handoff."purchaseItemId" = item."id"
      WHERE item."purchaseId" = OLD."id"
    )
  THEN
    RAISE EXCEPTION 'Purchase % supplier and currency are fixed by Recommendation handoff provenance.', OLD."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Purchase_prevent_handoff_commercial_mutation_trigger"
BEFORE UPDATE OF "supplierId", "currency" ON "Purchase"
FOR EACH ROW
EXECUTE FUNCTION "prevent_handoff_purchase_commercial_mutation"();

-- C21B will perform ACTIVE + CURRENT verification and lock current commercial
-- terms in its own transaction.  This trigger enforces the durable subset that
-- belongs at the database boundary: exact Recommendation/PurchaseItem identity,
-- quantity, selected package snapshot, supplier, currency, and lifecycle
-- version.  It intentionally avoids FKs to clearable terms/package rows.
CREATE FUNCTION "validate_recommendation_purchase_handoff"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recommendation "ReplenishmentRecommendation"%ROWTYPE;
  item_product_id TEXT;
  item_quantity DECIMAL(24,9);
  purchase_supplier_id TEXT;
  purchase_currency CHAR(3);
BEGIN
  SELECT * INTO recommendation
  FROM "ReplenishmentRecommendation"
  WHERE "id" = NEW."sourceRecommendationId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source Recommendation % was not found.', NEW."sourceRecommendationId"
      USING ERRCODE = '23503';
  END IF;

  IF recommendation."disposition" <> 'ACTIVE'::"ReplenishmentRecommendationDisposition"
    OR recommendation."version" <> NEW."sourceRecommendationVersion"
    OR recommendation."calculationPolicyVersion" <> NEW."sourceCalculationPolicyVersion"
    OR recommendation."relationshipIdSnapshot" <> NEW."sourceRelationshipId"
    OR recommendation."supplierIdSnapshot" <> NEW."sourceSupplierId"
    OR recommendation."feasibleQuantitySnapshot" <> NEW."sourceRecommendedQuantity"
  THEN
    RAISE EXCEPTION 'Recommendation handoff must snapshot the active source Recommendation exactly.'
      USING ERRCODE = '23514';
  END IF;

  IF (recommendation."packageIdSnapshot" IS NULL
      AND (NEW."sourcePackageId" IS NOT NULL OR NEW."sourcePackageCode" IS NOT NULL
           OR NEW."sourcePackageQuantity" IS NOT NULL OR NEW."sourcePackageVersion" IS NOT NULL))
    OR (recommendation."packageIdSnapshot" IS NOT NULL
      AND (NEW."sourcePackageId" IS DISTINCT FROM recommendation."packageIdSnapshot"
           OR NEW."sourcePackageCode" IS DISTINCT FROM recommendation."packageCodeSnapshot"
           OR NEW."sourcePackageQuantity" IS DISTINCT FROM recommendation."packageQuantitySnapshot"
           OR NEW."sourcePackageVersion" IS DISTINCT FROM recommendation."packageVersionSnapshot"))
  THEN
    RAISE EXCEPTION 'Recommendation handoff package snapshot must exactly match its source Recommendation.'
      USING ERRCODE = '23514';
  END IF;

  SELECT item."productId", item."quantity", purchase."supplierId", purchase."currency"
  INTO item_product_id, item_quantity, purchase_supplier_id, purchase_currency
  FROM "PurchaseItem" AS item
  INNER JOIN "Purchase" AS purchase ON purchase."id" = item."purchaseId"
  WHERE item."id" = NEW."purchaseItemId"
  FOR KEY SHARE OF item, purchase;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase item % was not found.', NEW."purchaseItemId"
      USING ERRCODE = '23503';
  END IF;

  IF item_product_id <> recommendation."productId"
    OR item_quantity <> NEW."sourceRecommendedQuantity"
    OR purchase_supplier_id <> NEW."sourceSupplierId"
    OR purchase_currency <> NEW."sourceCurrencyCode"
  THEN
    RAISE EXCEPTION 'Recommendation handoff PurchaseItem must exactly match the source Recommendation and commercial snapshot.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "RecommendationPurchaseHandoff_validate_source_trigger"
BEFORE INSERT ON "RecommendationPurchaseHandoff"
FOR EACH ROW
EXECUTE FUNCTION "validate_recommendation_purchase_handoff"();
