const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const { readDisposableDatabaseUrl } = require("./support/disposable-database.cjs");
const databaseUrl = readDisposableDatabaseUrl("RECOMMENDATION_PURCHASE_HANDOFF_DATABASE_URL");
const allowedDatabaseName = "lotus_brain_pr006c21a_handoff_test";

if (databaseUrl === undefined) {
  test("recommendation purchase handoff real database proof is opt-in", { skip: "RECOMMENDATION_PURCHASE_HANDOFF_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("recommendation purchase handoff proof requires its dedicated disposable database", () => {
      assert.fail(`RECOMMENDATION_PURCHASE_HANDOFF_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    test("handoff provenance is unique, immutable, and preserves snapshots without blocking mutable current terms", async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr006c21a-${randomUUID()}`;

      const cleanupDatabase = async () => {
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() });
        await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanup.end(); }
      };

      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "Each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "Supplier" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const actor = await prisma.user.create({ data: { email: `${fixture}@example.test`, displayName: "Actor", passwordHash: "not-used" } });
        const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id } });
        const terms = await prisma.productSupplierCommercialTerms.create({ data: { relationshipId: relationship.id, unitPrice: "12.345678", currencyCode: "JPY", taxRate: "0.1000" } });
        const packageRow = await prisma.productSupplierPackage.create({ data: { relationshipId: relationship.id, code: "CASE", name: "Case", inventoryQuantityPerPackage: "10", isOrderable: true } });

        const recommendation = await prisma.replenishmentRecommendation.create({ data: {
          productId: product.id, calculationPolicyVersion: 1,
          productCodeSnapshot: product.code, productNameSnapshot: product.name,
          inventoryUnitCodeSnapshot: unit.code, inventoryUnitNameSnapshot: unit.name, inventoryUnitSymbolSnapshot: unit.symbol,
          inventoryQuantitySnapshot: "5", inventoryVersionSnapshot: 1,
          replenishmentPolicyIdSnapshot: `${fixture}-policy`, replenishmentPolicyVersionSnapshot: 1,
          reorderPointQuantitySnapshot: "5", targetStockQuantitySnapshot: "15",
          supplierPreferenceIdSnapshot: `${fixture}-supplier-preference`, supplierPreferenceVersionSnapshot: 1,
          relationshipIdSnapshot: relationship.id, relationshipVersionSnapshot: relationship.version,
          supplierIdSnapshot: supplier.id, supplierCodeSnapshot: supplier.code, supplierNameSnapshot: supplier.name,
          orderingTermsIdSnapshot: null, orderingTermsVersionSnapshot: null, minimumOrderQuantitySnapshot: null, orderMultipleQuantitySnapshot: null,
          packagePreferenceIdSnapshot: `${fixture}-package-preference`, packagePreferenceVersionSnapshot: 1,
          packageIdSnapshot: packageRow.id, packageVersionSnapshot: packageRow.version,
          packageCodeSnapshot: packageRow.code, packageNameSnapshot: packageRow.name, packageQuantitySnapshot: packageRow.inventoryQuantityPerPackage,
          draftPurchaseQuantitySnapshot: "0", confirmedPurchaseQuantitySnapshot: "0",
          rawTargetGapSnapshot: "10", feasibleQuantitySnapshot: "10", overOrderQuantitySnapshot: "0", packageCountSnapshot: "1",
          createdByUserId: actor.id,
        } });

        const createPurchaseItem = async (suffix) => {
          const purchase = await prisma.purchase.create({ data: {
            supplierId: supplier.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z"), documentNumber: `${fixture}-${suffix}`,
            currency: "JPY", items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "10", unitPrice: "12.345678", lineAmount: "123.456780", taxRate: "0.1000" } },
          }, include: { items: true } });
          return { purchase, item: purchase.items[0] };
        };
        const first = await createPurchaseItem("first");
        const handoffData = (purchaseItemId) => ({
          sourceRecommendationId: recommendation.id,
          purchaseItemId,
          sourceRelationshipId: relationship.id,
          sourceSupplierId: supplier.id,
          sourceRecommendedQuantity: "10",
          sourceRecommendationVersion: recommendation.version,
          sourceCalculationPolicyVersion: recommendation.calculationPolicyVersion,
          sourcePackageId: packageRow.id,
          sourcePackageCode: packageRow.code,
          sourcePackageQuantity: "10",
          sourcePackageVersion: packageRow.version,
          sourceCommercialTermsId: terms.id,
          sourceCommercialTermsVersion: terms.version,
          sourceUnitPrice: "12.345678",
          sourceCurrencyCode: "JPY",
          sourceTaxRate: "0.1000",
        });

        const priceMismatch = await createPurchaseItem("price-mismatch");
        await assert.rejects(
          () => prisma.recommendationPurchaseHandoff.create({ data: { ...handoffData(priceMismatch.item.id), sourceUnitPrice: "12.345679" } }),
          (error) => error.message.includes("23514"),
        );

        const taxMismatch = await createPurchaseItem("tax-mismatch");
        await assert.rejects(
          () => prisma.recommendationPurchaseHandoff.create({ data: { ...handoffData(taxMismatch.item.id), sourceTaxRate: "0.0800" } }),
          (error) => error.message.includes("23514"),
        );

        const handoff = await prisma.recommendationPurchaseHandoff.create({ data: handoffData(first.item.id) });
        assert.equal(handoff.sourceRecommendationId, recommendation.id);
        assert.equal(handoff.sourceRecommendedQuantity.toFixed(9), "10.000000000");
        assert.equal(handoff.sourceUnitPrice.toFixed(6), "12.345678");

        // Current terms are clearable: retained scalar facts, not an FK to a
        // mutable master row, preserve the historical handoff's meaning.
        await prisma.productSupplierCommercialTerms.delete({ where: { relationshipId: relationship.id } });
        assert.equal((await prisma.recommendationPurchaseHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).sourceCommercialTermsId, terms.id);

        await assert.rejects(
          () => prisma.recommendationPurchaseHandoff.update({ where: { id: handoff.id }, data: { sourceUnitPrice: "1" } }),
          /immutable/i,
        );
        await assert.rejects(
          () => prisma.purchaseItem.update({ where: { id: first.item.id }, data: { quantity: "9" } }),
          /fixed by immutable Recommendation handoff provenance/i,
        );
        await assert.rejects(
          () => prisma.purchase.update({ where: { id: first.purchase.id }, data: { currency: "USD" } }),
          /fixed by Recommendation handoff provenance/i,
        );
        await prisma.purchase.update({ where: { id: first.purchase.id }, data: { note: "metadata remains editable" } });

        const second = await createPurchaseItem("second");
        await assert.rejects(
          () => prisma.recommendationPurchaseHandoff.create({ data: handoffData(second.item.id) }),
          /Unique constraint failed|unique/i,
        );
        await assert.rejects(
          () => prisma.recommendationPurchaseHandoff.create({ data: { ...handoffData(second.item.id), sourceRecommendedQuantity: "9" } }),
          /must snapshot the active source Recommendation exactly/i,
        );

        // Concurrent claims of one Recommendation leave exactly one durable
        // handoff. The second path is the database-enforced idempotency signal
        // that C21B will translate into a 200 replay.
        // C15B permits exactly one ACTIVE recommendation per product.
        await prisma.replenishmentRecommendation.update({ where: { id: recommendation.id }, data: { disposition: "SUPERSEDED", version: { increment: 1 }, supersededByUserId: actor.id, supersededAt: new Date() } });
        const concurrentRecommendation = await prisma.replenishmentRecommendation.create({ data: {
          productId: product.id, calculationPolicyVersion: 1,
          productCodeSnapshot: product.code, productNameSnapshot: product.name,
          inventoryUnitCodeSnapshot: unit.code, inventoryUnitNameSnapshot: unit.name, inventoryUnitSymbolSnapshot: unit.symbol,
          inventoryQuantitySnapshot: "5", inventoryVersionSnapshot: 1,
          replenishmentPolicyIdSnapshot: `${fixture}-policy-2`, replenishmentPolicyVersionSnapshot: 1,
          reorderPointQuantitySnapshot: "5", targetStockQuantitySnapshot: "15",
          supplierPreferenceIdSnapshot: `${fixture}-supplier-preference-2`, supplierPreferenceVersionSnapshot: 1,
          relationshipIdSnapshot: relationship.id, relationshipVersionSnapshot: relationship.version,
          supplierIdSnapshot: supplier.id, supplierCodeSnapshot: supplier.code, supplierNameSnapshot: supplier.name,
          orderingTermsIdSnapshot: null, orderingTermsVersionSnapshot: null, minimumOrderQuantitySnapshot: null, orderMultipleQuantitySnapshot: null,
          packagePreferenceIdSnapshot: `${fixture}-package-preference-2`, packagePreferenceVersionSnapshot: 1,
          packageIdSnapshot: packageRow.id, packageVersionSnapshot: packageRow.version,
          packageCodeSnapshot: packageRow.code, packageNameSnapshot: packageRow.name, packageQuantitySnapshot: packageRow.inventoryQuantityPerPackage,
          draftPurchaseQuantitySnapshot: "0", confirmedPurchaseQuantitySnapshot: "0",
          rawTargetGapSnapshot: "10", feasibleQuantitySnapshot: "10", overOrderQuantitySnapshot: "0", packageCountSnapshot: "1",
          createdByUserId: actor.id,
        } });
        const third = await createPurchaseItem("third");
        const fourth = await createPurchaseItem("fourth");
        const concurrentData = (purchaseItemId) => ({ ...handoffData(purchaseItemId), sourceRecommendationId: concurrentRecommendation.id, sourceRecommendationVersion: concurrentRecommendation.version });
        const results = await Promise.allSettled([
          prisma.recommendationPurchaseHandoff.create({ data: concurrentData(third.item.id) }),
          prisma.recommendationPurchaseHandoff.create({ data: concurrentData(fourth.item.id) }),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(results.filter((result) => result.status === "rejected").length, 1);
        assert.equal(await prisma.recommendationPurchaseHandoff.count({ where: { sourceRecommendationId: concurrentRecommendation.id } }), 1);
      } finally {
        await prisma.$disconnect();
        await cleanupDatabase();
      }
    });
  }
}
