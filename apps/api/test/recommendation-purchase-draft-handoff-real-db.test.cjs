const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const databaseUrl = process.env.RECOMMENDATION_PURCHASE_DRAFT_HANDOFF_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c21b_handoff_test";

if (databaseUrl === undefined) {
  test("recommendation purchase draft handoff real database proof is opt-in", { skip: "RECOMMENDATION_PURCHASE_DRAFT_HANDOFF_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("recommendation purchase draft handoff proof requires its dedicated disposable database", () => {
      assert.fail(`RECOMMENDATION_PURCHASE_DRAFT_HANDOFF_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { PrismaReplenishmentRecommendationRepository } = require("../dist/modules/replenishment/infrastructure/prisma-replenishment-recommendation.repository.js");
    const { PrismaPurchaseRecommendationHandoffRepository } = require("../dist/modules/purchase/infrastructure/prisma-recommendation-purchase-handoff.repository.js");
    const { PrismaPurchaseDraftRepository } = require("../dist/modules/purchase/infrastructure/purchase-draft.repository.js");

    test("handoff atomically creates one immutable purchase draft, replays idempotently, and fails closed on current-input drift", async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr006c21b-${randomUUID()}`;
      const recommendations = new PrismaReplenishmentRecommendationRepository(prisma);
      const handoffs = new PrismaPurchaseRecommendationHandoffRepository(prisma);
      const drafts = new PrismaPurchaseDraftRepository(prisma);
      const cleanupDatabase = async () => {
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() }); await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanup.end(); }
      };
      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "Each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "Supplier" } });
        const actor = await prisma.user.create({ data: { email: `${fixture}@example.test`, displayName: "Actor", passwordHash: "not-used" } });
        const ready = async (suffix, commercial = true) => {
          const product = await prisma.product.create({ data: { code: `${fixture}-${suffix}`, name: suffix, baseUnitId: unit.id, inventoryUnitId: unit.id } });
          await prisma.inventory.create({ data: { productId: product.id, quantity: "5" } });
          await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity: "5", targetStockQuantity: "12" } });
          const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id } });
          await prisma.productSupplyPreference.create({ data: { productId: product.id, relationshipId: relationship.id } });
          await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: relationship.id, minimumOrderQuantity: "10", orderMultipleQuantity: "5" } });
          const packageRow = await prisma.productSupplierPackage.create({ data: { relationshipId: relationship.id, code: "CASE", name: "Case", inventoryQuantityPerPackage: "10", isOrderable: true } });
          await prisma.productSupplierPackagePreference.create({ data: { relationshipId: relationship.id, packageId: packageRow.id } });
          if (commercial) await prisma.productSupplierCommercialTerms.create({ data: { relationshipId: relationship.id, unitPrice: "12.345678", currencyCode: "JPY", taxRate: "0.1000" } });
          const recommendation = await recommendations.recalculate(product.id, actor.id);
          assert.notEqual(recommendation, "NOT_READY"); assert.notEqual(recommendation, "NOT_FOUND");
          return { product, relationship, recommendation };
        };

        const first = await ready("FIRST");
        const created = await handoffs.createPurchaseDraft({ sourceRecommendationId: first.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") });
        assert.notEqual(created, "NOT_FOUND"); assert.notEqual(created, "CONFLICT");
        assert.equal(created.replayed, false); assert.equal(created.purchase.status, "DRAFT");
        assert.equal(created.purchase.purchaseDate.toISOString(), "2026-09-14T00:00:00.000Z");
        assert.deepEqual(created.purchase.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, taxRate: item.taxRate })), [{ quantity: "10", unitPrice: "12.345678", taxRate: "0.1" }]);
        assert.equal(await prisma.recommendationPurchaseHandoff.count({ where: { sourceRecommendationId: first.recommendation.id } }), 1);
        const persisted = await prisma.recommendationPurchaseHandoff.findUniqueOrThrow({ where: { sourceRecommendationId: first.recommendation.id } });
        assert.equal(persisted.sourceUnitPrice.toFixed(6), "12.345678"); assert.equal(persisted.sourceTaxRate.toFixed(4), "0.1000");
        const lineage = await handoffs.getLineageBySourceRecommendationId(first.recommendation.id);
        assert.notEqual(lineage, "NOT_FOUND"); assert.notEqual(lineage, null);
        assert.deepEqual(lineage.purchase, { id: created.purchase.id, status: "DRAFT", purchaseDate: new Date("2026-09-14T00:00:00.000Z") });
        assert.deepEqual(lineage.purchaseItem, { id: created.purchase.items[0].id });
        assert.deepEqual(lineage.source, {
          relationshipId: first.relationship.id,
          supplierId: supplier.id,
          recommendedQuantity: "10.000000000",
          package: { id: (await prisma.productSupplierPackage.findFirstOrThrow({ where: { relationshipId: first.relationship.id } })).id, code: "CASE", quantity: "10.000000000", version: 1 },
          commercialTerms: { id: (await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { relationshipId: first.relationship.id } })).id, version: 1, unitPrice: "12.345678", currencyCode: "JPY", taxRate: "0.1000" },
        });
        const notHandedOff = await ready("NOT-HANDED-OFF");
        assert.equal(await handoffs.getLineageBySourceRecommendationId(notHandedOff.recommendation.id), null);
        assert.equal(await handoffs.getLineageBySourceRecommendationId(`${fixture}-missing`), "NOT_FOUND");

        // The C21B command currently creates one Purchase per Recommendation,
        // but the read contract must not hard-code that transient shape. Build
        // two valid immutable handoffs under one Purchase and insert them in
        // reverse line order to prove the Purchase-origin query is a stable
        // ordered collection.
        const secondLine = await ready("SECOND-LINE");
        const firstLine = await ready("FIRST-LINE");
        const multiPurchase = await prisma.purchase.create({
          data: {
            supplierId: supplier.id,
            purchaseDate: new Date("2026-09-16T00:00:00.000Z"),
            currency: "JPY",
            subtotal: "246.913560",
            tax: "24.691356",
            total: "271.604916",
            items: {
              create: [
                { productId: firstLine.product.id, unitId: unit.id, lineNumber: 1, quantity: "10", unitPrice: "12.345678", taxRate: "0.1000", lineAmount: "123.456780" },
                { productId: secondLine.product.id, unitId: unit.id, lineNumber: 2, quantity: "10", unitPrice: "12.345678", taxRate: "0.1000", lineAmount: "123.456780" },
              ],
            },
          },
          include: { items: true },
        });
        const handoffDataFor = async (readyResult, purchaseItemId) => {
          const recommendation = await prisma.replenishmentRecommendation.findUniqueOrThrow({ where: { id: readyResult.recommendation.id } });
          const terms = await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { relationshipId: readyResult.relationship.id } });
          return {
            sourceRecommendationId: recommendation.id,
            purchaseItemId,
            sourceRelationshipId: recommendation.relationshipIdSnapshot,
            sourceSupplierId: recommendation.supplierIdSnapshot,
            sourceRecommendedQuantity: recommendation.feasibleQuantitySnapshot,
            sourceRecommendationVersion: recommendation.version,
            sourceCalculationPolicyVersion: recommendation.calculationPolicyVersion,
            sourcePackageId: recommendation.packageIdSnapshot,
            sourcePackageCode: recommendation.packageCodeSnapshot,
            sourcePackageQuantity: recommendation.packageQuantitySnapshot,
            sourcePackageVersion: recommendation.packageVersionSnapshot,
            sourceCommercialTermsId: terms.id,
            sourceCommercialTermsVersion: terms.version,
            sourceUnitPrice: terms.unitPrice,
            sourceCurrencyCode: "JPY",
            sourceTaxRate: terms.taxRate,
          };
        };
        const firstItem = multiPurchase.items.find((item) => item.lineNumber === 1);
        const secondItem = multiPurchase.items.find((item) => item.lineNumber === 2);
        assert.ok(firstItem); assert.ok(secondItem);
        await prisma.recommendationPurchaseHandoff.create({ data: await handoffDataFor(secondLine, secondItem.id) });
        await prisma.recommendationPurchaseHandoff.create({ data: await handoffDataFor(firstLine, firstItem.id) });
        const purchaseLineage = await handoffs.getLineagesByPurchaseId(multiPurchase.id);
        assert.notEqual(purchaseLineage, "NOT_FOUND");
        assert.deepEqual(purchaseLineage.map((lineage) => ({ recommendationId: lineage.sourceRecommendationId, lineNumber: lineage.lineNumber, purchaseItemId: lineage.purchaseItemId })), [
          { recommendationId: firstLine.recommendation.id, lineNumber: 1, purchaseItemId: firstItem.id },
          { recommendationId: secondLine.recommendation.id, lineNumber: 2, purchaseItemId: secondItem.id },
        ]);
        assert.deepEqual(await handoffs.getLineagesByPurchaseId(created.purchase.id), [{
          sourceRecommendationId: first.recommendation.id,
          createdAt: (await prisma.recommendationPurchaseHandoff.findUniqueOrThrow({ where: { sourceRecommendationId: first.recommendation.id } })).createdAt,
          purchaseItemId: created.purchase.items[0].id,
          lineNumber: 1,
          source: lineage.source,
        }]);
        const manualPurchase = await prisma.purchase.create({
          data: { supplierId: supplier.id, purchaseDate: new Date("2026-09-17T00:00:00.000Z") },
        });
        assert.deepEqual(await handoffs.getLineagesByPurchaseId(manualPurchase.id), []);
        assert.equal(await handoffs.getLineagesByPurchaseId(`${fixture}-missing-purchase`), "NOT_FOUND");

        const replay = await handoffs.createPurchaseDraft({ sourceRecommendationId: first.recommendation.id, purchaseDate: new Date("2027-01-01T00:00:00.000Z") });
        assert.notEqual(replay, "NOT_FOUND"); assert.notEqual(replay, "CONFLICT");
        assert.equal(replay.replayed, true); assert.equal(replay.purchase.id, created.purchase.id);
        assert.equal(replay.purchase.purchaseDate.toISOString(), "2026-09-14T00:00:00.000Z");

        assert.equal(await drafts.updateDraft(created.purchase.id, { supplierId: supplier.id, purchaseDate: "2026-09-14T00:00:00.000Z", items: [{ productId: first.product.id, unitId: unit.id, quantity: "9", unitPrice: "1", taxRate: "0" }] }), "CONFLICT");
        const metadata = await drafts.updateMetadata(created.purchase.id, { note: "operator metadata" });
        assert.notEqual(metadata, "NOT_FOUND"); assert.notEqual(metadata, "CONFLICT"); assert.equal(metadata.note, "operator metadata");

        // C24A makes cancellation terminal without deleting the immutable C21A
        // handoff row. Replaying the source Recommendation must not create a
        // second Purchase even after the original draft is cancelled.
        await prisma.purchase.update({
          where: { id: created.purchase.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "handoff cancelled" },
        });
        const cancelledReplay = await handoffs.createPurchaseDraft({
          sourceRecommendationId: first.recommendation.id,
          purchaseDate: new Date("2028-01-01T00:00:00.000Z"),
        });
        assert.notEqual(cancelledReplay, "NOT_FOUND"); assert.notEqual(cancelledReplay, "CONFLICT");
        assert.equal(cancelledReplay.replayed, true);
        assert.equal(cancelledReplay.purchase.id, created.purchase.id);
        assert.equal(cancelledReplay.purchase.status, "CANCELLED");
        assert.equal(await prisma.purchase.count({ where: { items: { some: { recommendationHandoff: { sourceRecommendationId: first.recommendation.id } } } } }), 1);

        const missingTerms = await ready("NO-TERMS", false);
        assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: missingTerms.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }), "CONFLICT");
        assert.equal(await prisma.purchase.count({ where: { items: { some: { productId: missingTerms.product.id } } } }), 0);

        const unitDrift = await ready("UNIT-DRIFT");
        await prisma.unit.update({ where: { id: unit.id }, data: { name: "Renamed Each" } });
        assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: unitDrift.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }), "CONFLICT");
        await prisma.unit.update({ where: { id: unit.id }, data: { name: "Each" } });

        // C21B rechecks the calculation-policy version itself, rather than
        // trusting only current input versions or the recommendation read API.
        const policyDrift = await ready("POLICY-DRIFT");
        const sourceRecommendation = await prisma.replenishmentRecommendation.findUniqueOrThrow({ where: { id: policyDrift.recommendation.id } });
        await prisma.replenishmentRecommendation.update({
          where: { id: sourceRecommendation.id },
          data: { disposition: "SUPERSEDED", version: { increment: 1 }, supersededByUserId: actor.id, supersededAt: new Date() },
        });
        const policyMismatched = await prisma.replenishmentRecommendation.create({ data: {
          ...sourceRecommendation,
          id: `${fixture}-policy-version-mismatch`,
          disposition: "ACTIVE",
          version: 1,
          calculationPolicyVersion: sourceRecommendation.calculationPolicyVersion + 1,
          supersededByUserId: null,
          supersededAt: null,
          dismissedByUserId: null,
          dismissedAt: null,
        } });
        assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: policyMismatched.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }), "CONFLICT");

        const concurrent = await ready("CONCURRENT");
        const results = await Promise.all([
          handoffs.createPurchaseDraft({ sourceRecommendationId: concurrent.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }),
          handoffs.createPurchaseDraft({ sourceRecommendationId: concurrent.recommendation.id, purchaseDate: new Date("2026-09-15T00:00:00.000Z") }),
        ]);
        assert.equal(results.filter((result) => result !== "NOT_FOUND" && result !== "CONFLICT" && result.replayed === false).length, 1);
        assert.equal(results.filter((result) => result !== "NOT_FOUND" && result !== "CONFLICT" && result.replayed === true).length, 1);
        assert.equal(await prisma.recommendationPurchaseHandoff.count({ where: { sourceRecommendationId: concurrent.recommendation.id } }), 1);
      } finally {
        await prisma.$disconnect(); await cleanupDatabase();
      }
    });
  }
}
