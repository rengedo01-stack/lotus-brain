import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Page } from "@playwright/test";

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const { PrismaPg } = apiRequire("@prisma/adapter-pg") as { PrismaPg: new (input: { connectionString: string }) => unknown };
const { PrismaClient } = apiRequire("./dist/generated/prisma/client.js") as {
  PrismaClient: new (input: { adapter: unknown }) => PrismaClientLike;
};
const argon2 = apiRequire("argon2") as {
  argon2id: number;
  hash(value: string, options: { type: number }): Promise<string>;
};
const { PrismaPurchaseDraftRepository } = apiRequire("./dist/modules/purchase/infrastructure/purchase-draft.repository.js") as {
  PrismaPurchaseDraftRepository: new (prisma: PrismaClientLike) => PurchaseDraftRepository;
};
const { PrismaPurchasePostingRepository } = apiRequire("./dist/modules/purchase/infrastructure/prisma-purchase-posting.repository.js") as {
  PrismaPurchasePostingRepository: new (prisma: PrismaClientLike) => unknown;
};
const { PostPurchaseUseCase } = apiRequire("./dist/modules/purchase/application/post-purchase.use-case.js") as {
  PostPurchaseUseCase: new (repository: unknown) => { execute(purchaseId: string): Promise<{ status: string }> };
};
const { PrismaPurchasePostedReversalRepository } = apiRequire("./dist/modules/purchase/infrastructure/prisma-purchase-posted-reversal.repository.js") as {
  PrismaPurchasePostedReversalRepository: new (prisma: PrismaClientLike) => unknown;
};
const { PurchasePostedReversalService } = apiRequire("./dist/modules/purchase/application/purchase-posted-reversal.service.js") as {
  PurchasePostedReversalService: new (repository: unknown) => PurchasePostedReversalService;
};
const { assertDisposableDatabaseUrl } = apiRequire("./test/support/disposable-database.cjs") as {
  assertDisposableDatabaseUrl(value: string, label?: string, options?: { allowGeneratedPortInGitHubActions?: boolean }): void;
};

const C24C2D_DATABASE_NAME = "lotus_brain_pr006c24c2d_browser_e2e_test";
const C26_DATABASE_NAME = "lotus_brain_pr006c26_recommendation_purchase_reorder_browser_e2e_test";
const DATABASE_NAME = process.env.LOTUS_WEB_E2E_DATABASE_NAME ?? C24C2D_DATABASE_NAME;
const ADMIN_EMAIL = "c24c2d-browser-admin@example.test";
const LEGACY_EMAIL = "c24c2d-browser-legacy@example.test";
const PASSWORD = "C24C2D browser fixture password";
const SYSTEM_ADMIN_ROLE_ID = "rbac-role-system-admin";
const LEGACY_ROLE_ID = "rbac-role-legacy-authenticated";

type PrismaClientLike = {
  $disconnect(): Promise<void>;
  inventory: { create(input: unknown): Promise<unknown> };
  product: { create(input: unknown): Promise<{ id: string }> };
  purchaseReversal: {
    count(input: { where: { purchaseId: string } }): Promise<number>;
  };
  supplier: { create(input: unknown): Promise<{ id: string }> };
  unit: { create(input: unknown): Promise<{ id: string }> };
  user: {
    findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null>;
    create(input: unknown): Promise<{ id: string }>;
  };
  userRole: { createMany(input: { data: Array<{ userId: string; roleId: string }>; skipDuplicates: boolean }): Promise<unknown> };
};

type PurchaseDraftRepository = {
  create(input: {
    supplierId: string;
    purchaseDate: string;
    documentNumber: string;
    items: Array<{ productId: string; unitId: string; quantity: string; unitPrice: string; taxRate: string }>;
  }): Promise<{ id: string }>;
  confirm(purchaseId: string): Promise<unknown>;
};

type PurchasePostedReversalService = {
  preview(purchaseId: string): Promise<PurchaseReversalPreview>;
  execute(input: {
    purchaseId: string;
    actorUserId: string;
    reason: string;
    previewVersion: string;
    idempotencyKey: string;
    priceResolutions: PriceResolution[];
  }): Promise<{ id: string; purchaseId: string; reversedAt: Date; replayed: boolean }>;
};

type PriceResolution = {
  productId: string;
  expectedPriceMasterVersion: number;
  currentUnitPrice: string;
  currency: string;
};

type PurchaseReversalPreview = {
  purchaseId: string;
  canReverse: boolean;
  previewVersion: string;
  priceEffects: Array<{
    productId: string;
    version: number | null;
    currentUnitPrice: string | null;
    currency: string | null;
    requiresPriceResolution: boolean;
  }>;
};

export type PostedPurchaseFixture = {
  productId: string;
  purchaseId: string;
};

export type PurchaseReversalE2EFixture = {
  admin: { email: string; id: string };
  legacy: { email: string; id: string };
  close(): Promise<void>;
  completeReversal(purchase: PostedPurchaseFixture, reason: string): Promise<{ id: string; reversedAt: Date }>;
  createPostedPurchase(label: string): Promise<PostedPurchaseFixture>;
  reversalCount(purchaseId: string): Promise<number>;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  const parsed = new URL(value);
  if (![C24C2D_DATABASE_NAME, C26_DATABASE_NAME].includes(DATABASE_NAME)) {
    throw new Error("LOTUS_WEB_E2E_DATABASE_NAME is not an approved disposable browser E2E database.");
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`LOTUS_WEB_E2E_DATABASE_URL must target ${DATABASE_NAME}.`);
  }
  return value;
}

function stateDirectory(): string {
  const directory = process.env.LOTUS_WEB_E2E_STATE_DIR;
  if (directory === undefined || directory.length === 0) throw new Error("LOTUS_WEB_E2E_STATE_DIR is required for browser E2E tests.");
  return directory;
}

function webBaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_BASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_BASE_URL is required for browser E2E tests.");
  return value;
}

export function storageStatePath(role: "admin" | "legacy"): string {
  return `${stateDirectory()}/${role}.json`;
}

function createPrisma(): PrismaClientLike {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
}

async function ensureUser(prisma: PrismaClientLike, input: { email: string; displayName: string; roleId: string }): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  const user = existing ?? await prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    },
  });
  await prisma.userRole.createMany({
    data: [{ userId: user.id, roleId: input.roleId }],
    skipDuplicates: true,
  });
  return user;
}

async function openFixture(createUsers: boolean): Promise<PurchaseReversalE2EFixture> {
  const prisma = createPrisma();
  try {
    const admin = createUsers
      ? await ensureUser(prisma, { email: ADMIN_EMAIL, displayName: "C24C-2D browser admin", roleId: SYSTEM_ADMIN_ROLE_ID })
      : await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    const legacy = createUsers
      ? await ensureUser(prisma, { email: LEGACY_EMAIL, displayName: "C24C-2D browser legacy", roleId: LEGACY_ROLE_ID })
      : await prisma.user.findUnique({ where: { email: LEGACY_EMAIL }, select: { id: true } });
    if (admin === null || legacy === null) throw new Error("Browser E2E authentication fixture is missing. Global setup must run first.");

    const draftRepository = new PrismaPurchaseDraftRepository(prisma);
    const postPurchase = new PostPurchaseUseCase(new PrismaPurchasePostingRepository(prisma));
    const reversalService = new PurchasePostedReversalService(new PrismaPurchasePostedReversalRepository(prisma));

    return {
      admin: { email: ADMIN_EMAIL, id: admin.id },
      legacy: { email: LEGACY_EMAIL, id: legacy.id },
      close: () => prisma.$disconnect(),
      async createPostedPurchase(label) {
        const nonce = randomUUID().replace(/-/g, "");
        const prefix = `c24c2d-${label}-${nonce}`;
        const unit = await prisma.unit.create({
          data: { code: `${prefix}-unit`, name: "C24C-2D unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const supplier = await prisma.supplier.create({
          data: { code: `${prefix}-supplier`, name: "C24C-2D supplier", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: {
            code: `${prefix}-product`,
            name: "C24C-2D reversal product",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "10.000000000", averageUnitCost: "100.000000" } });
        const draft = await draftRepository.create({
          supplierId: supplier.id,
          purchaseDate: "2026-09-23T00:00:00.000Z",
          documentNumber: `${prefix}-document`,
          items: [{ productId: product.id, unitId: unit.id, quantity: "2.000000000", unitPrice: "100.000000", taxRate: "0" }],
        });
        const confirmed = await draftRepository.confirm(draft.id);
        if (confirmed === "NOT_FOUND" || confirmed === "CONFLICT") throw new Error("E2E fixture could not confirm the purchase draft.");
        const posted = await postPurchase.execute(draft.id);
        assert.equal(posted.status, "POSTED");
        return { purchaseId: draft.id, productId: product.id };
      },
      async completeReversal(purchase, reason) {
        const preview = await reversalService.preview(purchase.purchaseId);
        if (!preview.canReverse) throw new Error("E2E fixture expected a reversible POSTED purchase.");
        const priceResolutions = preview.priceEffects.flatMap((effect): PriceResolution[] => {
          if (!effect.requiresPriceResolution) return [];
          if (effect.version === null || effect.currentUnitPrice === null || effect.currency === null) {
            throw new Error("E2E fixture expected a complete price resolution preview.");
          }
          return [{
            productId: effect.productId,
            expectedPriceMasterVersion: effect.version,
            currentUnitPrice: effect.currentUnitPrice,
            currency: effect.currency,
          }];
        });
        const result = await reversalService.execute({
          purchaseId: purchase.purchaseId,
          actorUserId: admin.id,
          reason,
          previewVersion: preview.previewVersion,
          idempotencyKey: randomUUID(),
          priceResolutions,
        });
        assert.equal(result.replayed, false);
        return { id: result.id, reversedAt: result.reversedAt };
      },
      reversalCount: (purchaseId) => prisma.purchaseReversal.count({ where: { purchaseId } }),
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

export async function openPurchaseReversalE2EFixture(): Promise<PurchaseReversalE2EFixture> {
  return openFixture(false);
}

async function loginWithPassword(page: Page, email: string): Promise<void> {
  await page.goto(new URL("/login", webBaseUrl()).toString());
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export default async function globalSetup(): Promise<() => void> {
  const fixture = await openFixture(true);
  const directory = stateDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [role, email, forwardedFor] of ([
      ["admin", fixture.admin.email, "198.18.1.10"],
      ["legacy", fixture.legacy.email, "198.18.1.11"],
    ] as const)) {
      const context = await browser.newContext();
      await context.setExtraHTTPHeaders({ "x-forwarded-for": forwardedFor });
      const page = await context.newPage();
      await loginWithPassword(page, email);
      await context.storageState({ path: storageStatePath(role) });
      await context.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
  return () => rmSync(directory, { recursive: true, force: true });
}
