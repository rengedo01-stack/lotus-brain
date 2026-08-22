const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.STOCKTAKE_DRAFT_UPDATE_DATABASE_URL;

if (databaseUrl === undefined) {
  test("stocktake draft update real database proof is opt-in", { skip: "STOCKTAKE_DRAFT_UPDATE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_stocktake_draft_update_test_[a-z0-9_]+$/.test(databaseName)) {
    test("stocktake draft update real database proof requires an isolated database", () => {
      assert.fail("STOCKTAKE_DRAFT_UPDATE_DATABASE_URL must target a dedicated database named lotus_brain_stocktake_draft_update_test_<name>.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Prisma, PrismaClient } = require("../dist/generated/prisma/client.js");
    const { PostStocktakeUseCase } = require("../dist/modules/stocktake/application/stocktake.use-cases.js");
    const { InvalidStocktakeError, StocktakeConflictError } = require("../dist/modules/stocktake/application/stocktake.errors.js");
    const { PrismaStocktakeRepository } = require("../dist/modules/stocktake/infrastructure/prisma-stocktake.repository.js");

    test("stocktake draft updates preserve line identity, unique products, atomicity, and posting effects in PostgreSQL", async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const repository = new PrismaStocktakeRepository(prisma);
      const post = new PostStocktakeUseCase(repository);
      const fixture = `pr005d1-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      async function createProduct(label, quantity) {
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-${label}-u`, name: `${label} unit`, symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: {
            code: `${fixture}-${label}-p`,
            name: `${label} product`,
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        const inventory = await prisma.inventory.create({
          data: { productId: product.id, quantity, averageUnitCost: "100.000000" },
        });
        return { product, inventory };
      }

      try {
        const productA = await createProduct("a", "10.000000000");
        const productB = await createProduct("b", "4.000000000");
        const productC = await createProduct("c", "3.000000000");

        const draft = await repository.create({
          note: "initial draft",
          items: [{ productId: productA.product.id, countedQuantity: "10.000000000", note: "initial A" }],
        });
        const originalA = draft.items[0];
        assert.ok(originalA);

        const sameProductUpdate = await repository.updateDraft(draft.id, {
          note: "same product update",
          items: [{ productId: productA.product.id, countedQuantity: "7.125000000", note: "updated A" }],
        });
        assert.equal(typeof sameProductUpdate, "object");
        assert.equal(sameProductUpdate.status, "DRAFT");
        assert.equal(sameProductUpdate.items.length, 1);
        assert.equal(sameProductUpdate.items[0].id, originalA.id);
        assert.equal(sameProductUpdate.items[0].countedQuantity, "7.125");
        assert.equal(sameProductUpdate.items[0].differenceQuantity, "-2.875");

        const addedProduct = await repository.updateDraft(draft.id, {
          note: "added product B",
          items: [
            { productId: productA.product.id, countedQuantity: "7.125000000", note: "still A" },
            { productId: productB.product.id, countedQuantity: "6.250000000", note: "new B" },
          ],
        });
        assert.equal(typeof addedProduct, "object");
        assert.equal(addedProduct.items.length, 2);
        const addedA = addedProduct.items.find((item) => item.productId === productA.product.id);
        const addedB = addedProduct.items.find((item) => item.productId === productB.product.id);
        assert.equal(addedA.id, originalA.id);
        assert.ok(addedB);

        const removedProduct = await repository.updateDraft(draft.id, {
          note: "removed product A",
          items: [{ productId: productB.product.id, countedQuantity: "6.250000000", note: "kept B" }],
        });
        assert.equal(typeof removedProduct, "object");
        assert.equal(removedProduct.items.length, 1);
        assert.equal(removedProduct.items[0].productId, productB.product.id);
        assert.equal(removedProduct.items[0].id, addedB.id);
        assert.equal(await prisma.stocktakeItem.count({ where: { stocktakeId: draft.id } }), 1);
        assert.equal(await prisma.stocktakeItem.count({ where: { stocktakeId: draft.id, productId: productA.product.id } }), 0);

        await assert.rejects(
          () => repository.updateDraft(draft.id, {
            items: [
              { productId: productB.product.id, countedQuantity: "6.250000000" },
              { productId: productB.product.id, countedQuantity: "6.250000000" },
            ],
          }),
          InvalidStocktakeError,
        );
        assert.equal(await prisma.stocktakeItem.count({ where: { stocktakeId: draft.id } }), 1);

        const confirmed = await repository.confirm(draft.id);
        assert.equal(typeof confirmed, "object");
        assert.equal(await repository.updateDraft(draft.id, {
          items: [{ productId: productB.product.id, countedQuantity: "6.250000000" }],
        }), "CONFLICT");

        const posted = await post.execute(draft.id);
        assert.equal(posted.status, "POSTED");
        assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: productB.inventory.id } })).quantity.toString(), "6.25");
        const histories = await prisma.inventoryHistory.findMany({
          where: { inventoryId: productB.inventory.id, type: "STOCKTAKE_ADJUSTMENT" },
        });
        assert.equal(histories.length, 1);
        assert.equal(histories[0].quantityDelta.toString(), "2.25");
        assert.equal(histories[0].quantityAfter.toString(), "6.25");

        const rollbackDraft = await repository.create({
          note: "rollback before",
          items: [{ productId: productA.product.id, countedQuantity: "8.000000000", note: "before failure" }],
        });
        const rollbackLine = rollbackDraft.items[0];
        const functionName = `pr005d1_draft_update_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'forced stocktake draft update failure'; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "StocktakeItem" FOR EACH ROW WHEN (NEW."productId" = '${productC.product.id}') EXECUTE FUNCTION "${functionName}"();`);
        try {
          await assert.rejects(
            () => repository.updateDraft(rollbackDraft.id, {
              note: "rollback after",
              items: [
                { productId: productA.product.id, countedQuantity: "9.000000000", note: "should roll back" },
                { productId: productC.product.id, countedQuantity: "1.000000000", note: "trigger failure" },
              ],
            }),
            /forced stocktake draft update failure/,
          );
          const rolledBack = await repository.get(rollbackDraft.id);
          assert.equal(rolledBack.note, "rollback before");
          assert.equal(rolledBack.items.length, 1);
          assert.equal(rolledBack.items[0].id, rollbackLine.id);
          assert.equal(rolledBack.items[0].countedQuantity, "8");
          assert.equal(await prisma.stocktakeItem.count({ where: { stocktakeId: rollbackDraft.id, productId: productC.product.id } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "StocktakeItem";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }

        const concurrentDraft = await repository.create({
          items: [{ productId: productA.product.id, countedQuantity: "1.000000000" }],
        });
        const concurrent = await Promise.allSettled([
          repository.updateDraft(concurrentDraft.id, { items: [{ productId: productA.product.id, countedQuantity: "2.000000000" }] }),
          repository.updateDraft(concurrentDraft.id, { items: [{ productId: productA.product.id, countedQuantity: "3.000000000" }] }),
        ]);
        assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 2);
        const concurrentItems = await prisma.stocktakeItem.findMany({ where: { stocktakeId: concurrentDraft.id } });
        assert.equal(concurrentItems.length, 1);
        assert.equal(concurrentItems[0].productId, productA.product.id);
        assert.ok(["2", "3"].includes(concurrentItems[0].countedQuantity.toString()));

        const postRaceDraft = await repository.create({
          items: [{ productId: productA.product.id, countedQuantity: "1.000000000" }],
        });
        const lockClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
        let releaseHeaderLock;
        const headerLockReleased = new Promise((resolve) => { releaseHeaderLock = resolve; });
        let headerLockAcquired;
        const headerLocked = new Promise((resolve) => { headerLockAcquired = resolve; });
        const headerLockTransaction = lockClient.$transaction(async (client) => {
          await client.$queryRaw(Prisma.sql`
            SELECT "id" FROM "Stocktake" WHERE "id" = ${postRaceDraft.id} FOR UPDATE
          `);
          headerLockAcquired();
          await headerLockReleased;
        });
        try {
          await headerLocked;
          const patch = repository.updateDraft(postRaceDraft.id, {
            note: "concurrent patch",
            items: [{ productId: productA.product.id, countedQuantity: "2.000000000" }],
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          const postAttempt = post.execute(postRaceDraft.id);
          await new Promise((resolve) => setTimeout(resolve, 50));
          releaseHeaderLock();

          const [patchResult, postResult] = await Promise.allSettled([patch, postAttempt]);
          assert.equal(patchResult.status, "fulfilled");
          assert.equal(postResult.status, "rejected");
          assert.ok(postResult.reason instanceof StocktakeConflictError);
          const afterPostRace = await repository.get(postRaceDraft.id);
          assert.equal(afterPostRace.status, "DRAFT");
          assert.equal(afterPostRace.items.length, 1);
          assert.equal(afterPostRace.items[0].countedQuantity, "2");
        } finally {
          releaseHeaderLock?.();
          await headerLockTransaction;
          await lockClient.$disconnect();
        }
      } finally {
        await prisma.$disconnect();
      }
    });
  }
}
