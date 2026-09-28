import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const { PrismaPg } = apiRequire("@prisma/adapter-pg") as { PrismaPg: new (input: { connectionString: string }) => unknown };
const { PrismaClient } = apiRequire("./dist/generated/prisma/client.js") as { PrismaClient: new (input: { adapter: unknown }) => PrismaClientLike };
const { assertDisposableDatabaseUrl } = apiRequire("./test/support/disposable-database.cjs") as { assertDisposableDatabaseUrl(value: string, label?: string, options?: { allowGeneratedPortInGitHubActions?: boolean }): void };

const DATABASE_NAME = "lotus_brain_pr006c26_recommendation_purchase_reorder_browser_e2e_test";
const ADMIN_EMAIL = "c24c2d-browser-admin@example.test";

type PrismaClientLike = {
  $disconnect(): Promise<void>;
  product: { create(input: { data: object }): Promise<{ id: string }> };
  recipe: {
    create(input: { data: object }): Promise<{ id: string }>;
    update(input: { where: { id: string }; data: object }): Promise<unknown>;
  };
  recipeItem: { create(input: { data: object }): Promise<unknown> };
  unit: { create(input: { data: object }): Promise<{ id: string }> };
  user: { findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

type RecipeRevisionProduct = { code: string; id: string; name: string };

export type RecipeRevisionSource = {
  ingredientA: RecipeRevisionProduct;
  ingredientAQuantity: string;
  ingredientB: RecipeRevisionProduct;
  ingredientBQuantity: string;
  note: string;
  output: RecipeRevisionProduct;
  recipeId: string;
  recipeName: string;
  unit: { code: string; id: string; name: string };
  yieldQuantity: string;
};

export type RecipeRevisionFixture = {
  close(): Promise<void>;
  createActiveRecipe(label: string): Promise<RecipeRevisionSource>;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  if (process.env.LOTUS_WEB_E2E_DATABASE_NAME !== DATABASE_NAME || decodeURIComponent(new URL(value).pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`C41 browser E2E must target ${DATABASE_NAME}.`);
  }
  return value;
}

export async function openRecipeRevisionFixture(): Promise<RecipeRevisionFixture> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    assert.notEqual(admin, null, "Browser E2E authentication fixture is missing. Global setup must run first.");

    return {
      close: () => prisma.$disconnect(),
      async createActiveRecipe(label) {
        const nonce = randomUUID().replace(/-/g, "");
        const prefix = `c41-${label}-${nonce}`;
        const unit = {
          code: `${prefix}-unit`,
          id: (await prisma.unit.create({
            data: { code: `${prefix}-unit`, name: "C41 recipe unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
          })).id,
          name: "C41 recipe unit",
        };
        async function createProduct(kind: "output" | "ingredient-a" | "ingredient-b", name: string): Promise<RecipeRevisionProduct> {
          const code = `${prefix}-${kind}`;
          const product = await prisma.product.create({
            data: {
              code,
              name,
              baseUnitId: unit.id,
              inventoryUnitId: unit.id,
              status: "ACTIVE",
            },
          });
          return { code, id: product.id, name };
        }

        const output = await createProduct("output", "C41 recipe output");
        const ingredientA = await createProduct("ingredient-a", "C41 recipe ingredient A");
        const ingredientB = await createProduct("ingredient-b", "C41 recipe ingredient B");
        const recipeId = randomUUID();
        const recipeName = `C41 revision recipe ${nonce}`;
        const note = `C41 revision note ${nonce}`;
        await prisma.recipe.create({
          data: {
            id: recipeId,
            rootRecipeId: recipeId,
            name: recipeName,
            outputProductId: output.id,
            yieldQuantity: "1",
            yieldUnitId: unit.id,
            status: "DRAFT",
            revision: 1,
            note,
          },
        });
        await prisma.recipeItem.create({
          data: { recipeId, productId: ingredientA.id, unitId: unit.id, quantity: "2", sortOrder: 0 },
        });
        await prisma.recipeItem.create({
          data: { recipeId, productId: ingredientB.id, unitId: unit.id, quantity: "3", sortOrder: 1 },
        });
        await prisma.recipe.update({ where: { id: recipeId }, data: { status: "ACTIVE" } });

        return {
          ingredientA,
          ingredientAQuantity: "2",
          ingredientB,
          ingredientBQuantity: "3",
          note,
          output,
          recipeId,
          recipeName,
          unit,
          yieldQuantity: "1",
        };
      },
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
