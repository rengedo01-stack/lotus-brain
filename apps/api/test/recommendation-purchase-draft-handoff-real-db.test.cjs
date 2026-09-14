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

        const replay = await handoffs.createPurchaseDraft({ sourceRecommendationId: first.recommendation.id, purchaseDate: new Date("2027-01-01T00:00:00.000Z") });
        assert.notEqual(replay, "NOT_FOUND"); assert.notEqual(replay, "CONFLICT");
        assert.equal(replay.replayed, true); assert.equal(replay.purchase.id, created.purchase.id);
        assert.equal(replay.purchase.purchaseDate.toISOString(), "2026-09-14T00:00:00.000Z");

        assert.equal(await drafts.updateDraft(created.purchase.id, { supplierId: supplier.id, purchaseDate: "2026-09-14T00:00:00.000Z", items: [{ productId: first.product.id, unitId: unit.id, quantity: "9", unitPrice: "1", taxRate: "0" }] }), "CONFLICT");
        const metadata = await drafts.updateMetadata(created.purchase.id, { note: "operator metadata" });
        assert.notEqual(metadata, "NOT_FOUND"); assert.notEqual(metadata, "CONFLICT"); assert.equal(metadata.note, "operator metadata");

        const missingTerms = await ready("NO-TERMS", false);
        assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: missingTerms.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }), "CONFLICT");
        assert.equal(await prisma.purchase.count({ where: { items: { some: { productId: missingTerms.product.id } } } }), 0);

        const unitDrift = await ready("UNIT-DRIFT");
        await prisma.unit.update({ where: { id: unit.id }, data: { name: "Renamed Each" } });
        assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: unitDrift.recommendation.id, purchaseDate: new Date("2026-09-14T00:00:00.000Z") }), "CONFLICT");
        await prisma.unit.update({ where: { id: unit.id }, data: { name: "Each" } });

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
