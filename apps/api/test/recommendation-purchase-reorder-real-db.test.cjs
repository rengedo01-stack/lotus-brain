const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const { readDisposableDatabaseUrl } = require("./support/disposable-database.cjs");
const databaseUrl = readDisposableDatabaseUrl("RECOMMENDATION_PURCHASE_REORDER_DATABASE_URL");
const allowedDatabaseName = "lotus_brain_pr006c26_recommendation_purchase_reorder_test";

if (databaseUrl === undefined) {
  test("recommendation purchase reorder real database proof is opt-in", { skip: "RECOMMENDATION_PURCHASE_REORDER_DATABASE_URL is not set" }, () => {});
} else if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== allowedDatabaseName) {
  test("recommendation purchase reorder proof requires its dedicated disposable database", () => {
    assert.fail(`RECOMMENDATION_PURCHASE_REORDER_DATABASE_URL must target ${allowedDatabaseName}.`);
  });
} else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { Client } = require("pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { PrismaReplenishmentRecommendationRepository } = require("../dist/modules/replenishment/infrastructure/prisma-replenishment-recommendation.repository.js");
  const { PrismaPurchaseRecommendationHandoffRepository } = require("../dist/modules/purchase/infrastructure/prisma-recommendation-purchase-handoff.repository.js");
  const { PrismaPurchaseDraftRepository } = require("../dist/modules/purchase/infrastructure/purchase-draft.repository.js");
  const { PrismaPurchasePostingRepository } = require("../dist/modules/purchase/infrastructure/prisma-purchase-posting.repository.js");
  const { PostPurchaseUseCase } = require("../dist/modules/purchase/application/post-purchase.use-case.js");
  const { PrismaPurchasePostedReversalRepository } = require("../dist/modules/purchase/infrastructure/prisma-purchase-posted-reversal.repository.js");
  const { PurchasePostedReversalService } = require("../dist/modules/purchase/application/purchase-posted-reversal.service.js");

  test("Recommendation replacement preserves cancelled and reversed Purchase lineage while creating a new current decision", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const fixture = `pr006c26-${randomUUID()}`;
    const recommendations = new PrismaReplenishmentRecommendationRepository(prisma);
    const handoffs = new PrismaPurchaseRecommendationHandoffRepository(prisma);
    const drafts = new PrismaPurchaseDraftRepository(prisma);
    const postPurchase = new PostPurchaseUseCase(new PrismaPurchasePostingRepository(prisma));
    const reversals = new PurchasePostedReversalService(new PrismaPurchasePostedReversalRepository(prisma));
    const cleanupUrl = new URL(databaseUrl);
    cleanupUrl.pathname = "/postgres";
    cleanupUrl.searchParams.delete("schema");

    const created = (value) => {
      assert.notEqual(value, "NOT_FOUND");
      assert.notEqual(value, "NOT_READY");
      assert.notEqual(value, "CONFLICT");
      return value;
    };
    const reversalPayload = (preview, reason) => ({
      purchaseId: preview.purchaseId,
      actorUserId: actor.id,
      reason,
      previewVersion: preview.previewVersion,
      idempotencyKey: randomUUID(),
      priceResolutions: preview.priceEffects.filter((effect) => effect.requiresPriceResolution).map((effect) => ({
        productId: effect.productId,
        expectedPriceMasterVersion: effect.version,
        currentUnitPrice: effect.currentUnitPrice,
        currency: effect.currency,
      })),
    });

    let actor;
    try {
      const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "Each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
      const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "Supplier", status: "ACTIVE" } });
      actor = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "C26 administrator", passwordHash: "not-used" } });
      await prisma.userRole.create({ data: { userId: actor.id, roleId: "rbac-role-system-admin" } });

      const ready = async (suffix) => {
        const product = await prisma.product.create({ data: {
          code: `${fixture}-${suffix}`, name: `C26 ${suffix}`, baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE",
        } });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "0.000000000", averageUnitCost: null } });
        await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity: "0.000000000", targetStockQuantity: "10.000000000" } });
        const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id, status: "ACTIVE" } });
        await prisma.productSupplyPreference.create({ data: { productId: product.id, relationshipId: relationship.id } });
        await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: relationship.id, minimumOrderQuantity: "10.000000000", orderMultipleQuantity: "10.000000000" } });
        await prisma.productSupplierCommercialTerms.create({ data: { relationshipId: relationship.id, unitPrice: "100.000000", currencyCode: "JPY", taxRate: "0.0000" } });
        return { product, recommendation: created(await recommendations.recalculate(product.id, actor.id)) };
      };
      const handoff = async (recommendation) => created(await handoffs.createPurchaseDraft({
        sourceRecommendationId: recommendation.id,
        purchaseDate: new Date("2026-09-24T00:00:00.000Z"),
      }));
      const readHandoff = (recommendationId) => prisma.recommendationPurchaseHandoff.findUniqueOrThrow({ where: { sourceRecommendationId: recommendationId } });

      // Case A: cancellation never releases A's immutable handoff. A new B is
      // created only by the existing current-condition recalculation command.
      const cancelled = await ready("CANCELLED");
      const cancelledA = await handoff(cancelled.recommendation);
      const cancelledHandoffBefore = await readHandoff(cancelled.recommendation.id);
      const cancellation = await drafts.cancel(cancelledA.purchase.id, "supplier withdrew stock", actor.id);
      assert.notEqual(cancellation, "NOT_FOUND");
      assert.notEqual(cancellation, "CONFLICT");
      assert.notEqual(cancellation, "FORBIDDEN");
      assert.equal(cancellation.status, "CANCELLED");
      const cancelledReplay = await handoff(cancelled.recommendation);
      assert.equal(cancelledReplay.replayed, true);
      assert.equal(cancelledReplay.purchase.id, cancelledA.purchase.id);
      assert.equal(cancelledReplay.purchase.status, "CANCELLED");
      assert.equal(await prisma.purchase.count({ where: { items: { some: { recommendationHandoff: { sourceRecommendationId: cancelled.recommendation.id } } } } }), 1);
      const cancelledB = created(await recommendations.recalculate(cancelled.product.id, actor.id));
      assert.notEqual(cancelledB.id, cancelled.recommendation.id);
      const cancelledPurchaseB = await handoff(cancelledB);
      assert.equal(cancelledPurchaseB.replayed, false);
      assert.notEqual(cancelledPurchaseB.purchase.id, cancelledA.purchase.id);
      assert.deepEqual(await readHandoff(cancelled.recommendation.id), cancelledHandoffBefore);
      assert.equal((await readHandoff(cancelledB.id)).purchaseItemId, cancelledPurchaseB.purchase.items[0].id);
      const cancelledPurchaseAAfter = await prisma.purchase.findUniqueOrThrow({ where: { id: cancelledA.purchase.id } });
      assert.equal(cancelledPurchaseAAfter.status, "CANCELLED");
      assert.equal(cancelledPurchaseAAfter.cancellationReason, "supplier withdrew stock");
      assert.equal(cancelledPurchaseAAfter.cancelledAt?.toISOString(), cancellation.cancelledAt.toISOString());

      // Case B: a real posted-purchase correction preserves both the A handoff
      // and the C25 ledger. It does not make A eligible for another handoff.
      const reversed = await ready("REVERSED");
      const reversedA = await handoff(reversed.recommendation);
      assert.equal((await postPurchase.execute(reversedA.purchase.id)).status, "POSTED");
      const reversalPreview = await reversals.preview(reversedA.purchase.id);
      assert.equal(reversalPreview.canReverse, true);
      const reversalExecution = await reversals.execute(reversalPayload(reversalPreview, "C26 re-order correction"));
      assert.equal(reversalExecution.replayed, false);
      const reversalAuditBefore = await reversals.readAudit(reversedA.purchase.id);
      assert.notEqual(reversalAuditBefore, null);
      const reversedHandoffBefore = await readHandoff(reversed.recommendation.id);
      const reversedReplay = await handoff(reversed.recommendation);
      assert.equal(reversedReplay.replayed, true);
      assert.equal(reversedReplay.purchase.id, reversedA.purchase.id);
      assert.equal(reversedReplay.purchase.status, "POSTED");
      const reversedB = created(await recommendations.recalculate(reversed.product.id, actor.id));
      assert.notEqual(reversedB.id, reversed.recommendation.id);
      const reversedPurchaseB = await handoff(reversedB);
      assert.equal(reversedPurchaseB.replayed, false);
      assert.notEqual(reversedPurchaseB.purchase.id, reversedA.purchase.id);
      assert.deepEqual(await readHandoff(reversed.recommendation.id), reversedHandoffBefore);
      assert.equal((await readHandoff(reversedB.id)).purchaseItemId, reversedPurchaseB.purchase.items[0].id);
      assert.deepEqual(await reversals.readAudit(reversedA.purchase.id), reversalAuditBefore);

      // Handoff-first and recalculate-first are both safe because both use the
      // existing Product-first synchronization boundary.
      const handoffFirst = await ready("HANDOFF-FIRST");
      const handoffFirstPurchase = await handoff(handoffFirst.recommendation);
      const handoffFirstB = created(await recommendations.recalculate(handoffFirst.product.id, actor.id));
      assert.equal((await handoff(handoffFirst.recommendation)).purchase.id, handoffFirstPurchase.purchase.id);
      assert.equal((await handoff(handoffFirstB)).replayed, false);

      const recalculateFirst = await ready("RECALCULATE-FIRST");
      const recalculateFirstB = created(await recommendations.recalculate(recalculateFirst.product.id, actor.id));
      assert.equal(await handoffs.createPurchaseDraft({ sourceRecommendationId: recalculateFirst.recommendation.id, purchaseDate: new Date("2026-09-24T00:00:00.000Z") }), "CONFLICT");
      assert.equal((await handoff(recalculateFirstB)).replayed, false);

      const concurrent = await ready("CONCURRENT-RECALCULATE");
      const concurrentResults = await Promise.all([
        recommendations.recalculate(concurrent.product.id, actor.id),
        recommendations.recalculate(concurrent.product.id, actor.id),
      ]);
      assert.equal(concurrentResults.filter((result) => result !== "NOT_FOUND" && result !== "NOT_READY").length, 2);
      assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: concurrent.product.id, disposition: "ACTIVE" } }), 1);
      assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: concurrent.product.id, disposition: "SUPERSEDED" } }), 2);

      // A database barrier pauses only the reversal's uncommitted Inventory
      // update. The competing recalculation must be visible as blocked on the
      // same transaction boundary. The existing calculation can therefore
      // return NOT_READY from a complete pre-reversal snapshot; only an
      // explicit calculation after reversal completion can create B.
      const reversalRace = await ready("REVERSAL-RACE");
      const reversalRaceA = await handoff(reversalRace.recommendation);
      assert.equal((await postPurchase.execute(reversalRaceA.purchase.id)).status, "POSTED");
      const raceInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: reversalRace.product.id } });
      const racePreview = await reversals.preview(reversalRaceA.purchase.id);
      const token = randomUUID().replace(/-/g, "").slice(0, 16);
      const functionName = `pr006c26_gate_${token}`;
      const triggerName = `${functionName}_trigger`;
      const advisoryKey = Number.parseInt(token.slice(0, 7), 16);
      const gate = new Client({ connectionString: databaseUrl });
      let advisoryLocked = false;
      let triggerCreated = false;
      const waitForDatabaseCondition = async (description, condition) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (await condition()) return;
          // This is bounded polling of a concrete database state, not a
          // timing delay used to make the test pass.
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Timed out waiting for ${description}.`);
      };
      try {
        await gate.connect();
        await gate.query("SELECT pg_advisory_lock($1)", [advisoryKey]);
        advisoryLocked = true;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$
          BEGIN
            IF OLD."id" = '${raceInventory.id}' THEN
              PERFORM pg_advisory_xact_lock(${advisoryKey});
            END IF;
            RETURN NEW;
          END;
        $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF "quantity" ON "Inventory" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        triggerCreated = true;
        const reversePromise = reversals.execute(reversalPayload(racePreview, "C26 controlled reversal race"));
        await waitForDatabaseCondition("the reversal transaction barrier", async () => {
          const waiting = await gate.query(
            "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1::oid AND NOT granted) AS blocked",
            [advisoryKey],
          );
          return waiting.rows[0].blocked;
        });
        const recalculationPromise = recommendations.recalculate(reversalRace.product.id, actor.id);
        await waitForDatabaseCondition("the recalculation transaction lock wait", async () => {
          const waiting = await gate.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND wait_event IS DISTINCT FROM 'advisory') AS blocked",
          );
          return waiting.rows[0].blocked;
        });
        await gate.query("SELECT pg_advisory_unlock($1)", [advisoryKey]);
        advisoryLocked = false;
        const [, recalculationDuringReversal] = await Promise.all([reversePromise, recalculationPromise]);
        assert.equal(recalculationDuringReversal, "NOT_READY");
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: reversalRace.product.id, disposition: "ACTIVE" } }), 1);
      } finally {
        if (advisoryLocked) await gate.query("SELECT pg_advisory_unlock($1)", [advisoryKey]);
        if (triggerCreated) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Inventory";`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        await gate.end();
      }
      const reversalRaceB = created(await recommendations.recalculate(reversalRace.product.id, actor.id));
      assert.notEqual(reversalRaceB.id, reversalRace.recommendation.id);
      assert.equal((await handoff(reversalRaceB)).replayed, false);
    } finally {
      await prisma.$disconnect();
      const cleanup = new Client({ connectionString: cleanupUrl.toString() });
      await cleanup.connect();
      try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanup.end(); }
    }
  });
}
