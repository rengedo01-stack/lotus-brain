-- Replenishment recommendations are immutable one-Product calculation
-- snapshots.  The current view derives freshness from live authoritative
-- inputs; it never writes STALE or INVALID back to this table.
CREATE TYPE "ReplenishmentRecommendationDisposition" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DISMISSED');

CREATE TABLE "ReplenishmentRecommendation" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "disposition" "ReplenishmentRecommendationDisposition" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "calculationPolicyVersion" INTEGER NOT NULL,

  "productCodeSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "inventoryUnitCodeSnapshot" TEXT NOT NULL,
  "inventoryUnitNameSnapshot" TEXT NOT NULL,
  "inventoryUnitSymbolSnapshot" TEXT NOT NULL,
  "inventoryQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "inventoryVersionSnapshot" INTEGER NOT NULL,
  "replenishmentPolicyIdSnapshot" TEXT NOT NULL,
  "replenishmentPolicyVersionSnapshot" INTEGER NOT NULL,
  "reorderPointQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "targetStockQuantitySnapshot" DECIMAL(24,9) NOT NULL,

  "supplierPreferenceIdSnapshot" TEXT NOT NULL,
  "supplierPreferenceVersionSnapshot" INTEGER NOT NULL,
  "relationshipIdSnapshot" TEXT NOT NULL,
  "relationshipVersionSnapshot" INTEGER NOT NULL,
  "supplierIdSnapshot" TEXT NOT NULL,
  "supplierCodeSnapshot" TEXT NOT NULL,
  "supplierNameSnapshot" TEXT NOT NULL,

  "orderingTermsIdSnapshot" TEXT,
  "orderingTermsVersionSnapshot" INTEGER,
  "minimumOrderQuantitySnapshot" DECIMAL(24,9),
  "orderMultipleQuantitySnapshot" DECIMAL(24,9),

  "packagePreferenceIdSnapshot" TEXT,
  "packagePreferenceVersionSnapshot" INTEGER,
  "packageIdSnapshot" TEXT,
  "packageVersionSnapshot" INTEGER,
  "packageCodeSnapshot" TEXT,
  "packageNameSnapshot" TEXT,
  "packageQuantitySnapshot" DECIMAL(24,9),

  "draftPurchaseQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "confirmedPurchaseQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "rawTargetGapSnapshot" DECIMAL(24,9) NOT NULL,
  "feasibleQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "overOrderQuantitySnapshot" DECIMAL(24,9) NOT NULL,
  "packageCountSnapshot" TEXT,

  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededByUserId" TEXT,
  "supersededAt" TIMESTAMP(3),
  "dismissedByUserId" TEXT,
  "dismissedAt" TIMESTAMP(3),

  CONSTRAINT "ReplenishmentRecommendation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReplenishmentRecommendation_version_positive_check" CHECK ("version" > 0),
  CONSTRAINT "ReplenishmentRecommendation_calculation_policy_positive_check" CHECK ("calculationPolicyVersion" > 0),
  CONSTRAINT "ReplenishmentRecommendation_input_versions_positive_check" CHECK (
    "inventoryVersionSnapshot" > 0
    AND "replenishmentPolicyVersionSnapshot" > 0
    AND "supplierPreferenceVersionSnapshot" > 0
    AND "relationshipVersionSnapshot" > 0
    AND ("orderingTermsVersionSnapshot" IS NULL OR "orderingTermsVersionSnapshot" > 0)
    AND ("packagePreferenceVersionSnapshot" IS NULL OR "packagePreferenceVersionSnapshot" > 0)
    AND ("packageVersionSnapshot" IS NULL OR "packageVersionSnapshot" > 0)
  ),
  CONSTRAINT "ReplenishmentRecommendation_quantities_valid_check" CHECK (
    "inventoryQuantitySnapshot" >= 0
    AND "reorderPointQuantitySnapshot" >= 0
    AND "targetStockQuantitySnapshot" >= "reorderPointQuantitySnapshot"
    AND "draftPurchaseQuantitySnapshot" >= 0
    AND "confirmedPurchaseQuantitySnapshot" >= 0
    AND "rawTargetGapSnapshot" > 0
    AND "feasibleQuantitySnapshot" > 0
    AND "overOrderQuantitySnapshot" >= 0
    AND ("minimumOrderQuantitySnapshot" IS NULL OR "minimumOrderQuantitySnapshot" > 0)
    AND ("orderMultipleQuantitySnapshot" IS NULL OR "orderMultipleQuantitySnapshot" > 0)
    AND ("packageQuantitySnapshot" IS NULL OR "packageQuantitySnapshot" > 0)
  ),
  CONSTRAINT "ReplenishmentRecommendation_ordering_terms_snapshot_pair_check" CHECK (
    ("orderingTermsIdSnapshot" IS NULL AND "orderingTermsVersionSnapshot" IS NULL)
    OR ("orderingTermsIdSnapshot" IS NOT NULL AND "orderingTermsVersionSnapshot" IS NOT NULL)
  ),
  CONSTRAINT "ReplenishmentRecommendation_package_snapshot_pair_check" CHECK (
    (
      "packagePreferenceIdSnapshot" IS NULL
      AND "packagePreferenceVersionSnapshot" IS NULL
      AND "packageIdSnapshot" IS NULL
      AND "packageVersionSnapshot" IS NULL
      AND "packageCodeSnapshot" IS NULL
      AND "packageNameSnapshot" IS NULL
      AND "packageQuantitySnapshot" IS NULL
      AND "packageCountSnapshot" IS NULL
    )
    OR (
      "packagePreferenceIdSnapshot" IS NOT NULL
      AND "packagePreferenceVersionSnapshot" IS NOT NULL
      AND "packageIdSnapshot" IS NOT NULL
      AND "packageVersionSnapshot" IS NOT NULL
      AND "packageCodeSnapshot" IS NOT NULL
      AND "packageNameSnapshot" IS NOT NULL
      AND "packageQuantitySnapshot" IS NOT NULL
      AND "packageCountSnapshot" IS NOT NULL
      AND "packageCountSnapshot" ~ '^[1-9][0-9]*$'
    )
  ),
  CONSTRAINT "ReplenishmentRecommendation_disposition_lifecycle_check" CHECK (
    (
      "disposition" = 'ACTIVE'
      AND "supersededByUserId" IS NULL AND "supersededAt" IS NULL
      AND "dismissedByUserId" IS NULL AND "dismissedAt" IS NULL
    )
    OR (
      "disposition" = 'SUPERSEDED'
      AND "supersededByUserId" IS NOT NULL AND "supersededAt" IS NOT NULL
      AND "dismissedByUserId" IS NULL AND "dismissedAt" IS NULL
    )
    OR (
      "disposition" = 'DISMISSED'
      AND "supersededByUserId" IS NULL AND "supersededAt" IS NULL
      AND "dismissedByUserId" IS NOT NULL AND "dismissedAt" IS NOT NULL
    )
  )
);

CREATE INDEX "ReplenishmentRecommendation_productId_createdAt_id_desc_idx"
  ON "ReplenishmentRecommendation" ("productId", "createdAt" DESC, "id" DESC);
CREATE INDEX "ReplenishmentRecommendation_disposition_createdAt_id_desc_idx"
  ON "ReplenishmentRecommendation" ("disposition", "createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "ReplenishmentRecommendation_one_active_per_product"
  ON "ReplenishmentRecommendation" ("productId")
  WHERE "disposition" = 'ACTIVE';

ALTER TABLE "ReplenishmentRecommendation"
  ADD CONSTRAINT "ReplenishmentRecommendation_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplenishmentRecommendation"
  ADD CONSTRAINT "ReplenishmentRecommendation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplenishmentRecommendation"
  ADD CONSTRAINT "ReplenishmentRecommendation_supersededByUserId_fkey"
  FOREIGN KEY ("supersededByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplenishmentRecommendation"
  ADD CONSTRAINT "ReplenishmentRecommendation_dismissedByUserId_fkey"
  FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The calculation snapshot is append-only.  An ACTIVE artifact can make one
-- terminal transition, atomically advancing only its lifecycle revision.
CREATE FUNCTION "prevent_replenishment_recommendation_snapshot_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId"
    OR NEW."calculationPolicyVersion" IS DISTINCT FROM OLD."calculationPolicyVersion"
    OR NEW."productCodeSnapshot" IS DISTINCT FROM OLD."productCodeSnapshot"
    OR NEW."productNameSnapshot" IS DISTINCT FROM OLD."productNameSnapshot"
    OR NEW."inventoryUnitCodeSnapshot" IS DISTINCT FROM OLD."inventoryUnitCodeSnapshot"
    OR NEW."inventoryUnitNameSnapshot" IS DISTINCT FROM OLD."inventoryUnitNameSnapshot"
    OR NEW."inventoryUnitSymbolSnapshot" IS DISTINCT FROM OLD."inventoryUnitSymbolSnapshot"
    OR NEW."inventoryQuantitySnapshot" IS DISTINCT FROM OLD."inventoryQuantitySnapshot"
    OR NEW."inventoryVersionSnapshot" IS DISTINCT FROM OLD."inventoryVersionSnapshot"
    OR NEW."replenishmentPolicyIdSnapshot" IS DISTINCT FROM OLD."replenishmentPolicyIdSnapshot"
    OR NEW."replenishmentPolicyVersionSnapshot" IS DISTINCT FROM OLD."replenishmentPolicyVersionSnapshot"
    OR NEW."reorderPointQuantitySnapshot" IS DISTINCT FROM OLD."reorderPointQuantitySnapshot"
    OR NEW."targetStockQuantitySnapshot" IS DISTINCT FROM OLD."targetStockQuantitySnapshot"
    OR NEW."supplierPreferenceIdSnapshot" IS DISTINCT FROM OLD."supplierPreferenceIdSnapshot"
    OR NEW."supplierPreferenceVersionSnapshot" IS DISTINCT FROM OLD."supplierPreferenceVersionSnapshot"
    OR NEW."relationshipIdSnapshot" IS DISTINCT FROM OLD."relationshipIdSnapshot"
    OR NEW."relationshipVersionSnapshot" IS DISTINCT FROM OLD."relationshipVersionSnapshot"
    OR NEW."supplierIdSnapshot" IS DISTINCT FROM OLD."supplierIdSnapshot"
    OR NEW."supplierCodeSnapshot" IS DISTINCT FROM OLD."supplierCodeSnapshot"
    OR NEW."supplierNameSnapshot" IS DISTINCT FROM OLD."supplierNameSnapshot"
    OR NEW."orderingTermsIdSnapshot" IS DISTINCT FROM OLD."orderingTermsIdSnapshot"
    OR NEW."orderingTermsVersionSnapshot" IS DISTINCT FROM OLD."orderingTermsVersionSnapshot"
    OR NEW."minimumOrderQuantitySnapshot" IS DISTINCT FROM OLD."minimumOrderQuantitySnapshot"
    OR NEW."orderMultipleQuantitySnapshot" IS DISTINCT FROM OLD."orderMultipleQuantitySnapshot"
    OR NEW."packagePreferenceIdSnapshot" IS DISTINCT FROM OLD."packagePreferenceIdSnapshot"
    OR NEW."packagePreferenceVersionSnapshot" IS DISTINCT FROM OLD."packagePreferenceVersionSnapshot"
    OR NEW."packageIdSnapshot" IS DISTINCT FROM OLD."packageIdSnapshot"
    OR NEW."packageVersionSnapshot" IS DISTINCT FROM OLD."packageVersionSnapshot"
    OR NEW."packageCodeSnapshot" IS DISTINCT FROM OLD."packageCodeSnapshot"
    OR NEW."packageNameSnapshot" IS DISTINCT FROM OLD."packageNameSnapshot"
    OR NEW."packageQuantitySnapshot" IS DISTINCT FROM OLD."packageQuantitySnapshot"
    OR NEW."draftPurchaseQuantitySnapshot" IS DISTINCT FROM OLD."draftPurchaseQuantitySnapshot"
    OR NEW."confirmedPurchaseQuantitySnapshot" IS DISTINCT FROM OLD."confirmedPurchaseQuantitySnapshot"
    OR NEW."rawTargetGapSnapshot" IS DISTINCT FROM OLD."rawTargetGapSnapshot"
    OR NEW."feasibleQuantitySnapshot" IS DISTINCT FROM OLD."feasibleQuantitySnapshot"
    OR NEW."overOrderQuantitySnapshot" IS DISTINCT FROM OLD."overOrderQuantitySnapshot"
    OR NEW."packageCountSnapshot" IS DISTINCT FROM OLD."packageCountSnapshot"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ReplenishmentRecommendation calculation snapshots are immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD."disposition" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A terminal ReplenishmentRecommendation cannot change again.' USING ERRCODE = '23514';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'ReplenishmentRecommendation lifecycle version must increment exactly once.' USING ERRCODE = '23514';
  END IF;

  IF NEW."disposition" = 'SUPERSEDED'
    AND NEW."supersededByUserId" IS NOT NULL AND NEW."supersededAt" IS NOT NULL
    AND NEW."dismissedByUserId" IS NULL AND NEW."dismissedAt" IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF NEW."disposition" = 'DISMISSED'
    AND NEW."dismissedByUserId" IS NOT NULL AND NEW."dismissedAt" IS NOT NULL
    AND NEW."supersededByUserId" IS NULL AND NEW."supersededAt" IS NULL
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'An ACTIVE ReplenishmentRecommendation must transition to one terminal disposition.' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "ReplenishmentRecommendation_prevent_snapshot_mutation_trigger"
BEFORE UPDATE ON "ReplenishmentRecommendation"
FOR EACH ROW
EXECUTE FUNCTION "prevent_replenishment_recommendation_snapshot_mutation"();

-- This permission intentionally does not extend LEGACY_AUTHENTICATED.  It is
-- explicit operational authority for creating, recalculating, and dismissing
-- persisted replenishment artifacts; SYSTEM_ADMIN receives it on rollout.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-replenishment-manage', 'replenishment.manage', 'Create, recalculate, or dismiss replenishment recommendations.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
INNER JOIN "Permission" ON "Permission"."code" = 'replenishment.manage'
WHERE "Role"."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
