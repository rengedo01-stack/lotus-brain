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
  unit: { create(input: { data: object }): Promise<{ id: string }> };
  user: { findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

export type RecipeLifecycleFixture = {
  close(): Promise<void>;
  createMasters(label: string): Promise<RecipeLifecycleMasters>;
};

export type RecipeLifecycleMasters = {
  ingredientA: RecipeLifecycleProduct;
  ingredientB: RecipeLifecycleProduct;
  ingredientAQuantity: string;
  ingredientBQuantity: string;
  note: string;
  output: RecipeLifecycleProduct;
  recipeName: string;
  unit: RecipeLifecycleUnit;
  yieldQuantity: string;
};

export type RecipeLifecycleProduct = {
  code: string;
  id: string;
  name: string;
};

export type RecipeLifecycleUnit = {
  code: string;
  id: string;
  name: string;
  symbol: string;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  if (process.env.LOTUS_WEB_E2E_DATABASE_NAME !== DATABASE_NAME || decodeURIComponent(new URL(value).pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`C40 browser E2E must target ${DATABASE_NAME}.`);
  }
  return value;
}

export async function openRecipeLifecycleFixture(): Promise<RecipeLifecycleFixture> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    assert.notEqual(admin, null, "Browser E2E authentication fixture is missing. Global setup must run first.");

    return {
      close: () => prisma.$disconnect(),
      async createMasters(label) {
        const nonce = randomUUID().replace(/-/g, "");
        const prefix = `c40-${label}-${nonce}`;
        const unit: RecipeLifecycleUnit = {
          code: `${prefix}-unit`,
          id: (await prisma.unit.create({
            data: { code: `${prefix}-unit`, name: "C40 recipe unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
          })).id,
          name: "C40 recipe unit",
          symbol: "ea",
        };
        async function createProduct(kind: "output" | "ingredient-a" | "ingredient-b", name: string): Promise<RecipeLifecycleProduct> {
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

        const output = await createProduct("output", "C40 recipe output");
        const ingredientA = await createProduct("ingredient-a", "C40 recipe ingredient A");
        const ingredientB = await createProduct("ingredient-b", "C40 recipe ingredient B");
        return {
          ingredientA,
          ingredientB,
          ingredientAQuantity: "2",
          ingredientBQuantity: "3",
          note: `C40 recipe note ${nonce}`,
          output,
          recipeName: `C40 recipe ${nonce}`,
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
