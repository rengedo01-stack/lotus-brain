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
  inventory: { create(input: { data: object }): Promise<unknown> };
  product: { create(input: { data: object }): Promise<{ id: string }> };
  recipe: {
    create(input: { data: object }): Promise<{ id: string }>;
    update(input: { where: { id: string }; data: object }): Promise<unknown>;
  };
  recipeItem: { create(input: { data: object }): Promise<unknown> };
  unit: { create(input: { data: object }): Promise<{ id: string }> };
  user: { findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

export type ProductionLifecycleFixture = {
  close(): Promise<void>;
  createActiveRecipe(label: string): Promise<ProductionRecipe>;
};

export type ProductionRecipe = {
  actualQuantity: string;
  outputProductId: string;
  plannedQuantity: string;
  recipeId: string;
  recipeName: string;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  if (process.env.LOTUS_WEB_E2E_DATABASE_NAME !== DATABASE_NAME || decodeURIComponent(new URL(value).pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`C39 browser E2E must target ${DATABASE_NAME}.`);
  }
  return value;
}

export async function openProductionLifecycleFixture(): Promise<ProductionLifecycleFixture> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    assert.notEqual(admin, null, "Browser E2E authentication fixture is missing. Global setup must run first.");

    return {
      close: () => prisma.$disconnect(),
      async createActiveRecipe(label) {
        const nonce = randomUUID().replace(/-/g, "");
        const prefix = `c39-${label}-${nonce}`;
        const unit = await prisma.unit.create({
          data: { code: `${prefix}-unit`, name: "C39 production unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const output = await prisma.product.create({
          data: {
            code: `${prefix}-output`,
            name: "C39 production output",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        const ingredient = await prisma.product.create({
          data: {
            code: `${prefix}-ingredient`,
            name: "C39 production ingredient",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        await prisma.inventory.create({ data: { productId: output.id, quantity: "0", averageUnitCost: null } });
        await prisma.inventory.create({ data: { productId: ingredient.id, quantity: "10", averageUnitCost: "100" } });

        const recipeId = randomUUID();
        const recipeName = `C39 production recipe ${nonce}`;
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
          },
        });
        await prisma.recipeItem.create({
          data: {
            recipeId,
            productId: ingredient.id,
            unitId: unit.id,
            quantity: "2",
            sortOrder: 0,
          },
        });
        await prisma.recipe.update({ where: { id: recipeId }, data: { status: "ACTIVE" } });

        return {
          actualQuantity: "2",
          outputProductId: output.id,
          plannedQuantity: "1",
          recipeId,
          recipeName,
        };
      },
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
