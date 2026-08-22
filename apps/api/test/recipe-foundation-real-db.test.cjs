const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const databaseUrl = process.env.RECIPE_DATABASE_URL;

if (databaseUrl === undefined) {
  test("recipe foundation real database proof is opt-in", { skip: "RECIPE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_recipe_test_[a-z0-9_]+$/.test(databaseName)) {
    test("recipe foundation real database proof requires an isolated database", () => {
      assert.fail("RECIPE_DATABASE_URL must target a dedicated database named lotus_brain_recipe_test_<name>.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { RecipeValidationError } = require("../dist/modules/recipe/application/recipe.errors.js");
    const { PrismaRecipeRepository } = require("../dist/modules/recipe/infrastructure/prisma-recipe.repository.js");

    test("recipe PostgreSQL proof preserves decimal BOMs, revisions, structural immutability, and rollback", async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const repository = new PrismaRecipeRepository(prisma);
      const fixture = `pr005e0-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      async function createProduct(label, unit) {
        return prisma.product.create({
          data: {
            code: `${fixture}-${label}-p`,
            name: `${label} product`,
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
      }

      try {
        const outputUnit = await prisma.unit.create({
          data: { code: `${fixture}-out-u`, name: "output unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const materialUnit = await prisma.unit.create({
          data: { code: `${fixture}-material-u`, name: "material unit", symbol: "kg", dimension: "MASS", status: "ACTIVE" },
        });
        const output = await createProduct("output", outputUnit);
        const material = await createProduct("material", materialUnit);
        const inactive = await prisma.product.create({
          data: {
            code: `${fixture}-inactive-p`,
            name: "inactive material",
            baseUnitId: materialUnit.id,
            inventoryUnitId: materialUnit.id,
            status: "INACTIVE",
          },
        });

        const input = {
          name: "Decimal recipe",
          outputProductId: output.id,
          yieldQuantity: "4.000000000",
          yieldUnitId: outputUnit.id,
          note: "immutable source",
          items: [{ productId: material.id, unitId: materialUnit.id, quantity: "1.250000000" }],
        };
        const draft = await repository.createDraft(input);
        assert.equal(draft.status, "DRAFT");
        assert.equal(draft.revision, 1);
        assert.equal(draft.rootRecipeId, draft.id);
        assert.equal(draft.yieldQuantity, "4");
        assert.equal(draft.items[0].quantity, "1.25");

        await assert.rejects(
          () => repository.createDraft({ ...input, items: [{ productId: inactive.id, unitId: materialUnit.id, quantity: "1" }] }),
          RecipeValidationError,
        );
        assert.equal(await prisma.recipe.count({ where: { outputProductId: output.id } }), 1);

        await assert.rejects(
          () => repository.createDraft({ ...input, yieldQuantity: "1.1234567891" }),
          RecipeValidationError,
        );
        await assert.rejects(
          () => repository.createDraft({
            ...input,
            items: [
              input.items[0],
              { productId: material.id, unitId: materialUnit.id, quantity: "2" },
            ],
          }),
          RecipeValidationError,
        );
        assert.equal(await prisma.recipe.count({ where: { outputProductId: output.id } }), 1);

        const directActiveRecipeId = randomUUID();
        await assert.rejects(() => prisma.recipe.create({
          data: {
            id: directActiveRecipeId,
            rootRecipeId: directActiveRecipeId,
            name: "must start as draft",
            outputProductId: output.id,
            yieldQuantity: "1.000000000",
            yieldUnitId: outputUnit.id,
            status: "ACTIVE",
            revision: 1,
          },
        }));

        const activated = await repository.activate(draft.id);
        assert.equal(typeof activated, "object");
        assert.equal(activated.status, "ACTIVE");
        assert.equal(await repository.updateDraft(draft.id, input), "CONFLICT");
        await assert.rejects(() => prisma.recipe.update({
          where: { id: draft.id },
          data: { yieldQuantity: "5.000000000" },
        }));
        await assert.rejects(() => prisma.recipe.update({
          where: { id: draft.id },
          data: { status: "DRAFT" },
        }));
        const activeItem = await prisma.recipeItem.findFirstOrThrow({ where: { recipeId: draft.id } });
        await assert.rejects(() => prisma.recipeItem.update({
          where: { id: activeItem.id },
          data: { quantity: "2.000000000" },
        }));

        const revision = await repository.createRevision(draft.id);
        assert.equal(typeof revision, "object");
        assert.equal(revision.status, "DRAFT");
        assert.equal(revision.revision, 2);
        assert.equal(revision.rootRecipeId, draft.rootRecipeId);
        assert.equal(revision.items[0].quantity, "1.25");
        assert.equal((await repository.get(draft.id)).revision, 1);
        assert.equal(await repository.updateDraft(revision.id, {
          ...input,
          outputProductId: material.id,
        }), "CONFLICT");
        await assert.rejects(() => prisma.recipe.update({
          where: { id: revision.id },
          data: { outputProductId: material.id },
        }));
        await assert.rejects(() => prisma.recipe.update({
          where: { id: revision.id },
          data: { revision: 99 },
        }));

        const revisedDraft = await repository.updateDraft(revision.id, {
          ...input,
          name: "Decimal recipe revision",
          yieldQuantity: "5.500000000",
          items: [{ productId: material.id, unitId: materialUnit.id, quantity: "2.750000000" }],
        });
        assert.equal(typeof revisedDraft, "object");
        assert.equal(revisedDraft.yieldQuantity, "5.5");
        assert.equal(revisedDraft.items[0].quantity, "2.75");

        const archived = await repository.archive(draft.id);
        assert.equal(typeof archived, "object");
        assert.equal(archived.status, "ARCHIVED");
        const concurrentRevisions = await Promise.all([
          repository.createRevision(draft.id),
          repository.createRevision(draft.id),
        ]);
        assert.deepEqual(concurrentRevisions.map((item) => item.revision).sort(), [3, 4]);

        await prisma.production.create({
          data: {
            recipeId: revision.id,
            productionDate: new Date("2026-08-22T00:00:00.000Z"),
            plannedQuantity: "2.000000000",
            outputProductIdSnapshot: output.id,
            yieldQuantitySnapshot: "5.500000000",
            outputUnitIdSnapshot: outputUnit.id,
            note: "existing production reference",
          },
        });
        assert.equal(await repository.updateDraft(revision.id, input), "CONFLICT");
        const revisionItem = await prisma.recipeItem.findFirstOrThrow({ where: { recipeId: revision.id } });
        await assert.rejects(() => prisma.recipeItem.update({
          where: { id: revisionItem.id },
          data: { quantity: "3.000000000" },
        }));

        const rollbackDraft = await repository.createDraft(input);
        const rollbackBefore = await repository.get(rollbackDraft.id);
        const functionName = `pr005e0_recipe_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'forced recipe item failure'; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "RecipeItem" FOR EACH ROW WHEN (NEW."recipeId" = '${rollbackDraft.id}') EXECUTE FUNCTION "${functionName}"();`);
        try {
          await assert.rejects(() => repository.updateDraft(rollbackDraft.id, {
            ...input,
            name: "should roll back",
            items: [{ productId: material.id, unitId: materialUnit.id, quantity: "9.000000000" }],
          }), /forced recipe item failure/);
          const rollbackAfter = await repository.get(rollbackDraft.id);
          assert.equal(rollbackAfter.name, rollbackBefore.name);
          assert.equal(rollbackAfter.items[0].id, rollbackBefore.items[0].id);
          assert.equal(rollbackAfter.items[0].quantity, "1.25");
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "RecipeItem";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }
        await assert.rejects(() => prisma.recipeItem.create({
          data: {
            recipeId: rollbackDraft.id,
            productId: material.id,
            unitId: materialUnit.id,
            quantity: "2.000000000",
            sortOrder: 1,
          },
        }));
      } finally {
        await prisma.$disconnect();
      }
    });
  }
}
