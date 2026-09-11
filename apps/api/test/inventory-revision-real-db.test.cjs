const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");

const databaseUrl = process.env.INVENTORY_REVISION_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c15a_inventory_revision_test";

if (databaseUrl === undefined) {
  test("inventory revision PostgreSQL proof is opt-in", { skip: "INVENTORY_REVISION_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("inventory revision proof requires its dedicated disposable database", () => {
      assert.fail(`INVENTORY_REVISION_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    test("inventory revision migration, monotonicity, rollback, and change-away-and-back are exact", async () => {
      process.env.DATABASE_URL = databaseUrl;
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr006c15a-${randomUUID()}`;
      const raw = new Client({ connectionString: databaseUrl });

      const createProduct = async (suffix, unitId) => prisma.product.create({
        data: {
          code: `${fixture}-${suffix}`,
          name: `PR-006C15A ${suffix}`,
          baseUnitId: unitId,
          inventoryUnitId: unitId,
        },
      });

      const mutateWithRowLock = async (inventoryId, quantity) => {
        const client = new Client({ connectionString: databaseUrl });
        await client.connect();
        let transactionOpen = false;
        try {
          await client.query("BEGIN");
          transactionOpen = true;
          await client.query('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE', [inventoryId]);
          await client.query('UPDATE "Inventory" SET "quantity" = $1, "version" = "version" + 1 WHERE "id" = $2', [quantity, inventoryId]);
          await client.query("COMMIT");
          transactionOpen = false;
        } finally {
          if (transactionOpen) await client.query("ROLLBACK");
          await client.end();
        }
      };

      try {
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-EA`, name: "PR-006C15A each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const legacyProduct = await createProduct("LEGACY", unit.id);
        await prisma.inventory.create({ data: { productId: legacyProduct.id, quantity: "10" } });

        // Simulate a row that existed before this forward-only migration, then
        // apply the checked-in SQL to prove the default backfill and invariant.
        await raw.connect();
        await raw.query('ALTER TABLE "Inventory" DROP CONSTRAINT "Inventory_version_positive_check"');
        await raw.query('ALTER TABLE "Inventory" DROP COLUMN "version"');
        const migrationSql = readFileSync(
          join(__dirname, "../prisma/migrations/20260911200000_add_inventory_revision_foundation/migration.sql"),
          "utf8",
        );
        await raw.query(migrationSql);

        const migratedLegacyInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: legacyProduct.id } });
        assert.equal(migratedLegacyInventory.quantity.toString(), "10");
        assert.equal(migratedLegacyInventory.version, 1);

        const newProduct = await createProduct("NEW", unit.id);
        const newInventory = await prisma.inventory.create({ data: { productId: newProduct.id, quantity: "0" } });
        assert.equal(newInventory.version, 1);
        await assert.rejects(
          () => raw.query('UPDATE "Inventory" SET "version" = 0 WHERE "id" = $1', [newInventory.id]),
        );
        await assert.rejects(
          () => raw.query('UPDATE "Inventory" SET "version" = -1 WHERE "id" = $1', [newInventory.id]),
        );

        const revisionProduct = await createProduct("REVISION", unit.id);
        const revisionInventory = await prisma.inventory.create({ data: { productId: revisionProduct.id, quantity: "10" } });
        assert.equal(revisionInventory.version, 1);
        await mutateWithRowLock(revisionInventory.id, "8");
        const afterFirstMutation = await prisma.inventory.findUniqueOrThrow({ where: { id: revisionInventory.id } });
        assert.equal(afterFirstMutation.quantity.toString(), "8");
        assert.equal(afterFirstMutation.version, 2);
        await mutateWithRowLock(revisionInventory.id, "10");
        const afterReturnMutation = await prisma.inventory.findUniqueOrThrow({ where: { id: revisionInventory.id } });
        assert.equal(afterReturnMutation.quantity.toString(), "10");
        assert.equal(afterReturnMutation.version, 3);

        await assert.rejects(
          () => prisma.$transaction(async (transaction) => {
            await transaction.inventory.update({
              where: { id: revisionInventory.id },
              data: { quantity: "6", version: { increment: 1 } },
            });
            throw new Error("force rollback");
          }),
          /force rollback/,
        );
        const afterRollback = await prisma.inventory.findUniqueOrThrow({ where: { id: revisionInventory.id } });
        assert.equal(afterRollback.quantity.toString(), "10");
        assert.equal(afterRollback.version, 3);

        await Promise.all([
          mutateWithRowLock(revisionInventory.id, "7"),
          mutateWithRowLock(revisionInventory.id, "9"),
        ]);
        const afterConcurrentMutations = await prisma.inventory.findUniqueOrThrow({ where: { id: revisionInventory.id } });
        assert.ok(["7", "9"].includes(afterConcurrentMutations.quantity.toString()));
        assert.equal(afterConcurrentMutations.version, 5);
      } finally {
        await raw.end();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() });
        await cleanup.connect();
        try {
          await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`);
        } finally {
          await cleanup.end();
        }
      }
    });
  }
}
