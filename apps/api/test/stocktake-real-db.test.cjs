const test = require("node:test");
const assert = require("node:assert/strict");

const databaseUrl = process.env.STOCKTAKE_DATABASE_URL;

if (databaseUrl === undefined) {
  test("stocktake real database proof is opt-in", { skip: "STOCKTAKE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_stocktake_test_[a-z0-9_]+$/.test(databaseName)) {
    test("stocktake real database proof requires an isolated database", () => {
      assert.fail("STOCKTAKE_DATABASE_URL must target a dedicated database named lotus_brain_stocktake_test_<name>.");
    });
  } else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { Client } = require("pg");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { PostStocktakeUseCase } = require("../dist/modules/stocktake/application/stocktake.use-cases.js");
  const { StocktakeConflictError } = require("../dist/modules/stocktake/application/stocktake.errors.js");
  const { PrismaStocktakeRepository } = require("../dist/modules/stocktake/infrastructure/prisma-stocktake.repository.js");

  test("stocktake PostgreSQL proof preserves decimal snapshots, one-time posting, and rollback", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const repository = new PrismaStocktakeRepository(prisma);
    const post = new PostStocktakeUseCase(repository);
    const fixture = `pr005d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    async function createProduct(label, quantity) {
      const unit = await prisma.unit.create({ data: { code: `${fixture}-${label}-u`, name: `${label} unit`, symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
      const product = await prisma.product.create({ data: { code: `${fixture}-${label}-p`, name: `${label} product`, baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" } });
      await prisma.inventory.create({ data: { productId: product.id, quantity, averageUnitCost: "100.000000" } });
      return product;
    }

    async function createConfirmedStocktake(productId, countedQuantity) {
      const stocktake = await repository.create({ note: "real database proof", items: [{ productId, countedQuantity }] });
      const confirmed = await repository.confirm(stocktake.id);
      assert.notEqual(confirmed, "NOT_FOUND");
      assert.notEqual(confirmed, "CONFLICT");
      return stocktake.id;
    }

    try {
      const product = await createProduct("lifecycle", "10.000000000");
      const stocktakeId = await createConfirmedStocktake(product.id, "12.345678901");

      const concurrent = await Promise.allSettled([post.execute(stocktakeId), post.execute(stocktakeId)]);
      assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
      assert.equal((await prisma.stocktake.findUniqueOrThrow({ where: { id: stocktakeId } })).status, "POSTED");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } })).quantity.toString(), "12.345678901");
      const stocktakeItem = await prisma.stocktakeItem.findFirstOrThrow({ where: { stocktakeId } });
      assert.equal(stocktakeItem.systemQuantitySnapshot.toString(), "10");
      assert.equal(stocktakeItem.countedQuantity.toString(), "12.345678901");
      assert.equal(stocktakeItem.differenceQuantity.toString(), "2.345678901");
      const adjustment = await prisma.inventoryAdjustment.findUniqueOrThrow({ where: { stocktakeId } });
      assert.equal(adjustment.status, "POSTED");
      assert.equal(await prisma.inventoryAdjustmentItem.count({ where: { adjustmentId: adjustment.id } }), 1);
      const histories = await prisma.inventoryHistory.findMany({ where: { type: "STOCKTAKE_ADJUSTMENT" } });
      assert.equal(histories.length, 1);
      assert.equal(histories[0].quantityDelta.toString(), "2.345678901");
      assert.equal(histories[0].quantityAfter.toString(), "12.345678901");
      assert.ok(histories[0].sourceInventoryAdjustmentItemId);

      await assert.rejects(() => post.execute(stocktakeId), StocktakeConflictError);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { stocktakeId } }), 1);
      assert.equal(await prisma.inventoryHistory.count({ where: { type: "STOCKTAKE_ADJUSTMENT" } }), 1);

      const draft = await repository.create({ items: [{ productId: product.id, countedQuantity: "12.345678901" }] });
      await assert.rejects(() => post.execute(draft.id), StocktakeConflictError);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { stocktakeId: draft.id } }), 0);

      const rollbackProduct = await createProduct("rollback", "9.000000000");
      const rollbackStocktakeId = await createConfirmedStocktake(rollbackProduct.id, "8.000000000");
      const functionName = `pr005d_stocktake_rollback_${Date.now()}`;
      const triggerName = `${functionName}_trigger`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'forced stocktake history failure'; END; $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "InventoryHistory" FOR EACH ROW WHEN (NEW."type" = 'STOCKTAKE_ADJUSTMENT'::"InventoryTransactionType") EXECUTE FUNCTION "${functionName}"();`);
      try {
        await assert.rejects(() => post.execute(rollbackStocktakeId), /forced stocktake history failure/);
        assert.equal((await prisma.stocktake.findUniqueOrThrow({ where: { id: rollbackStocktakeId } })).status, "CONFIRMED");
        assert.equal(await prisma.inventoryAdjustment.count({ where: { stocktakeId: rollbackStocktakeId } }), 0);
        assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: rollbackProduct.id } })).quantity.toString(), "9");
        assert.equal(await prisma.inventoryHistory.count({ where: { type: "STOCKTAKE_ADJUSTMENT" } }), 1);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "InventoryHistory";`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
      }
    } finally {
      try {
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanupClient = new Client({ connectionString: cleanupUrl.toString() });
        await cleanupClient.connect();
        try {
          await cleanupClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE);`);
        } finally {
          await cleanupClient.end();
        }
      } finally {
        await prisma.$disconnect();
      }
    }
  });
  }
}
