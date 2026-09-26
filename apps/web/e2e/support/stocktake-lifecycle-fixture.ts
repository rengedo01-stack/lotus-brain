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
  unit: { create(input: { data: object }): Promise<{ id: string }> };
  user: { findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
};

export type StocktakeLifecycleFixture = {
  close(): Promise<void>;
  createProduct(label: string): Promise<StocktakeProduct>;
};

export type StocktakeProduct = {
  expectedBookQuantity: string;
  expectedCountedQuantity: string;
  expectedDifferenceQuantity: string;
  productCode: string;
  productId: string;
  productName: string;
  unitSymbol: string;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  if (process.env.LOTUS_WEB_E2E_DATABASE_NAME !== DATABASE_NAME || decodeURIComponent(new URL(value).pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`C38 browser E2E must target ${DATABASE_NAME}.`);
  }
  return value;
}

export async function openStocktakeLifecycleFixture(): Promise<StocktakeLifecycleFixture> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    assert.notEqual(admin, null, "Browser E2E authentication fixture is missing. Global setup must run first.");

    return {
      close: () => prisma.$disconnect(),
      async createProduct(label) {
        const nonce = randomUUID().replace(/-/g, "");
        const prefix = `c38-${label}-${nonce}`;
        const unit = await prisma.unit.create({
          data: { code: `${prefix}-unit`, name: "C38 stocktake unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: {
            code: `${prefix}-product`,
            name: "C38 stocktake product",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "10", averageUnitCost: null } });
        return {
          expectedBookQuantity: "10",
          expectedCountedQuantity: "7",
          expectedDifferenceQuantity: "-3",
          productCode: `${prefix}-product`,
          productId: product.id,
          productName: "C38 stocktake product",
          unitSymbol: "ea",
        };
      },
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
