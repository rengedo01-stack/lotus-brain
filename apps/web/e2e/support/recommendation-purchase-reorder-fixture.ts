import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const apiRequire = createRequire(new URL("../../../api/package.json", import.meta.url));
const { PrismaPg } = apiRequire("@prisma/adapter-pg") as { PrismaPg: new (input: { connectionString: string }) => unknown };
const { PrismaClient } = apiRequire("./dist/generated/prisma/client.js") as { PrismaClient: new (input: { adapter: unknown }) => PrismaClientLike };
const { PrismaReplenishmentRecommendationRepository } = apiRequire("./dist/modules/replenishment/infrastructure/prisma-replenishment-recommendation.repository.js") as { PrismaReplenishmentRecommendationRepository: new (prisma: PrismaClientLike) => ReplenishmentRepository };
const { PrismaPurchaseRecommendationHandoffRepository } = apiRequire("./dist/modules/purchase/infrastructure/prisma-recommendation-purchase-handoff.repository.js") as { PrismaPurchaseRecommendationHandoffRepository: new (prisma: PrismaClientLike) => HandoffRepository };
const { PrismaPurchasePostingRepository } = apiRequire("./dist/modules/purchase/infrastructure/prisma-purchase-posting.repository.js") as { PrismaPurchasePostingRepository: new (prisma: PrismaClientLike) => unknown };
const { PostPurchaseUseCase } = apiRequire("./dist/modules/purchase/application/post-purchase.use-case.js") as { PostPurchaseUseCase: new (repository: unknown) => { execute(purchaseId: string): Promise<{ status: string }> } };
const { PrismaPurchasePostedReversalRepository } = apiRequire("./dist/modules/purchase/infrastructure/prisma-purchase-posted-reversal.repository.js") as { PrismaPurchasePostedReversalRepository: new (prisma: PrismaClientLike) => unknown };
const { PurchasePostedReversalService } = apiRequire("./dist/modules/purchase/application/purchase-posted-reversal.service.js") as { PurchasePostedReversalService: new (repository: unknown) => ReversalService };
const { assertDisposableDatabaseUrl } = apiRequire("./test/support/disposable-database.cjs") as { assertDisposableDatabaseUrl(value: string, label?: string, options?: { allowGeneratedPortInGitHubActions?: boolean }): void };

const DATABASE_NAME = "lotus_brain_pr006c26_recommendation_purchase_reorder_browser_e2e_test";
const ADMIN_EMAIL = "c24c2d-browser-admin@example.test";

type PrismaClientLike = {
  $disconnect(): Promise<void>;
  inventory: { create(input: { data: object }): Promise<unknown> };
  product: { create(input: { data: object }): Promise<{ id: string }> };
  productSupplierPackage: { create(input: { data: object }): Promise<{ id: string }> };
  productSupplierPackagePreference: { create(input: { data: object }): Promise<unknown> };
  productSupplierCommercialTerms: { create(input: { data: object }): Promise<unknown> };
  productSupplierOrderingTerms: { create(input: { data: object }): Promise<unknown> };
  productSupplyPreference: { create(input: { data: object }): Promise<unknown> };
  productSupplyRelationship: { create(input: { data: object }): Promise<{ id: string }> };
  replenishmentPolicy: { create(input: { data: object }): Promise<unknown> };
  supplier: { create(input: { data: object }): Promise<{ id: string }> };
  unit: { create(input: { data: object }): Promise<{ id: string }> };
  user: { findUnique(input: { where: { email: string }; select: { id: true } }): Promise<{ id: string } | null> };
};
type ReplenishmentRepository = {
  getActive(productId: string): Promise<{ id: string } | null>;
  recalculate(productId: string, actorUserId: string): Promise<{ id: string } | "NOT_FOUND" | "NOT_READY">;
};
type HandoffRepository = {
  createPurchaseDraft(input: { sourceRecommendationId: string; purchaseDate: Date }): Promise<{ replayed: boolean; purchase: { id: string } } | "NOT_FOUND" | "CONFLICT">;
  getLineageBySourceRecommendationId(recommendationId: string): Promise<{ purchase: { id: string } } | null | "NOT_FOUND">;
};
type ReversalService = {
  preview(purchaseId: string): Promise<{ purchaseId: string; canReverse: boolean; previewVersion: string; priceEffects: Array<{ productId: string; version: number | null; currentUnitPrice: string | null; currency: string | null; requiresPriceResolution: boolean }> }>;
  execute(input: { purchaseId: string; actorUserId: string; reason: string; previewVersion: string; idempotencyKey: string; priceResolutions: Array<{ productId: string; expectedPriceMasterVersion: number; currentUnitPrice: string; currency: string }> }): Promise<{ replayed: boolean }>;
  readAudit(purchaseId: string): Promise<unknown>;
};

export type RecommendationPurchaseReorderFixture = {
  close(): Promise<void>;
  activeRecommendationId(productId: string): Promise<string>;
  createReadyReplenishmentProduct(label: string): Promise<ReadyReplenishmentProduct>;
  createReversedRecommendation(label: string): Promise<{ productId: string; recommendationAId: string; purchaseAId: string; audit: unknown }>;
  handoffPurchaseId(recommendationId: string): Promise<string>;
  readAudit(purchaseId: string): Promise<unknown>;
};

export type ReadyReplenishmentProduct = {
  productId: string;
  productCode: string;
  productName: string;
  supplierCode: string;
  supplierName: string;
  packageCode: string;
  packageName: string;
  unitSymbol: string;
  listCurrentQuantity: string;
  listReorderPointQuantity: string;
  currentQuantity: string;
  reorderPointQuantity: string;
  targetStockQuantity: string;
  rawTargetGap: string;
  feasibleQuantity: string;
  packageCount: string;
  overOrderQuantity: string;
  recommendationFeasibleQuantity: string;
  inventoryRevision: string;
};

type SeededReplenishmentProduct = {
  productId: string;
  productCode: string;
  productName: string;
  supplierCode: string;
  supplierName: string;
  packageCode: string | null;
  packageName: string | null;
};

function databaseUrl(): string {
  const value = process.env.LOTUS_WEB_E2E_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("LOTUS_WEB_E2E_DATABASE_URL is required for browser E2E tests.");
  assertDisposableDatabaseUrl(value, "LOTUS_WEB_E2E_DATABASE_URL", { allowGeneratedPortInGitHubActions: true });
  if (process.env.LOTUS_WEB_E2E_DATABASE_NAME !== DATABASE_NAME || decodeURIComponent(new URL(value).pathname.slice(1)) !== DATABASE_NAME) {
    throw new Error(`C26 browser E2E must target ${DATABASE_NAME}.`);
  }
  return value;
}

function created<T>(value: T | "NOT_FOUND" | "NOT_READY" | "CONFLICT"): T {
  assert.notEqual(value, "NOT_FOUND");
  assert.notEqual(value, "NOT_READY");
  assert.notEqual(value, "CONFLICT");
  return value as T;
}

async function seedReplenishmentProduct(
  prisma: PrismaClientLike,
  input: {
    label: string;
    prefix: "c26" | "c37";
    unitName: string;
    supplierName: string;
    productName: string;
    currentQuantity: string;
    reorderPointQuantity: string;
    targetStockQuantity: string;
    minimumOrderQuantity: string;
    orderMultipleQuantity: string;
    packageSize: string | null;
    withCommercialTerms: boolean;
  },
): Promise<SeededReplenishmentProduct> {
  const nonce = randomUUID().replace(/-/g, "");
  const prefix = `${input.prefix}-${input.label}-${nonce}`;
  const unit = await prisma.unit.create({ data: { code: `${prefix}-unit`, name: input.unitName, symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
  const supplier = await prisma.supplier.create({ data: { code: `${prefix}-supplier`, name: input.supplierName, status: "ACTIVE" } });
  const product = await prisma.product.create({ data: { code: `${prefix}-product`, name: input.productName, baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" } });
  await prisma.inventory.create({ data: { productId: product.id, quantity: input.currentQuantity, averageUnitCost: null } });
  await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity: input.reorderPointQuantity, targetStockQuantity: input.targetStockQuantity } });
  const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id, status: "ACTIVE" } });
  await prisma.productSupplyPreference.create({ data: { productId: product.id, relationshipId: relationship.id } });
  await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: relationship.id, minimumOrderQuantity: input.minimumOrderQuantity, orderMultipleQuantity: input.orderMultipleQuantity } });
  if (input.withCommercialTerms) {
    await prisma.productSupplierCommercialTerms.create({ data: { relationshipId: relationship.id, unitPrice: "100.000000", currencyCode: "JPY", taxRate: "0.0000" } });
  }
  if (input.packageSize === null) {
    return { productId: product.id, productCode: `${prefix}-product`, productName: input.productName, supplierCode: `${prefix}-supplier`, supplierName: input.supplierName, packageCode: null, packageName: null };
  }
  const packageRow = await prisma.productSupplierPackage.create({ data: { relationshipId: relationship.id, code: `${prefix}-package`, name: `${input.prefix.toUpperCase()} package`, inventoryQuantityPerPackage: input.packageSize, isOrderable: true, status: "ACTIVE" } });
  await prisma.productSupplierPackagePreference.create({ data: { relationshipId: relationship.id, packageId: packageRow.id } });
  return { productId: product.id, productCode: `${prefix}-product`, productName: input.productName, supplierCode: `${prefix}-supplier`, supplierName: input.supplierName, packageCode: `${prefix}-package`, packageName: `${input.prefix.toUpperCase()} package` };
}

export async function openRecommendationPurchaseReorderFixture(): Promise<RecommendationPurchaseReorderFixture> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) });
  try {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    if (admin === null) throw new Error("Browser E2E authentication fixture is missing. Global setup must run first.");
    const recommendations = new PrismaReplenishmentRecommendationRepository(prisma);
    const handoffs = new PrismaPurchaseRecommendationHandoffRepository(prisma);
    const postPurchase = new PostPurchaseUseCase(new PrismaPurchasePostingRepository(prisma));
    const reversals = new PurchasePostedReversalService(new PrismaPurchasePostedReversalRepository(prisma));

    return {
      close: () => prisma.$disconnect(),
      async activeRecommendationId(productId) {
        const recommendation = await recommendations.getActive(productId);
        if (recommendation === null) throw new Error("Expected one active C26 Recommendation.");
        return recommendation.id;
      },
      async createReadyReplenishmentProduct(label) {
        const product = await seedReplenishmentProduct(prisma, {
          label,
          prefix: "c37",
          unitName: "C37 unit",
          supplierName: "C37 supplier",
          productName: "C37 replenishment product",
          currentQuantity: "5.000000000",
          reorderPointQuantity: "5.000000000",
          targetStockQuantity: "12.000000000",
          minimumOrderQuantity: "12.000000000",
          orderMultipleQuantity: "5.000000000",
          packageSize: "6.000000000",
          withCommercialTerms: false,
        });
        if (product.packageCode === null || product.packageName === null) throw new Error("Expected a C37 preferred package.");
        return {
          ...product,
          packageCode: product.packageCode,
          packageName: product.packageName,
          unitSymbol: "ea",
          listCurrentQuantity: "5",
          listReorderPointQuantity: "5",
          currentQuantity: "5.000000000",
          reorderPointQuantity: "5.000000000",
          targetStockQuantity: "12.000000000",
          rawTargetGap: "7",
          feasibleQuantity: "30",
          packageCount: "5",
          overOrderQuantity: "23",
          recommendationFeasibleQuantity: "30.000000000",
          inventoryRevision: "1",
        };
      },
      async createReversedRecommendation(label) {
        const product = await seedReplenishmentProduct(prisma, {
          label,
          prefix: "c26",
          unitName: "C26 unit",
          supplierName: "C26 supplier",
          productName: "C26 reorder product",
          currentQuantity: "0.000000000",
          reorderPointQuantity: "0.000000000",
          targetStockQuantity: "10.000000000",
          minimumOrderQuantity: "10.000000000",
          orderMultipleQuantity: "10.000000000",
          packageSize: null,
          withCommercialTerms: true,
        });
        const recommendationA = created(await recommendations.recalculate(product.productId, admin.id));
        const purchaseA = created(await handoffs.createPurchaseDraft({ sourceRecommendationId: recommendationA.id, purchaseDate: new Date("2026-09-24T00:00:00.000Z") }));
        assert.equal(purchaseA.replayed, false);
        assert.equal((await postPurchase.execute(purchaseA.purchase.id)).status, "POSTED");
        const preview = await reversals.preview(purchaseA.purchase.id);
        assert.equal(preview.canReverse, true);
        const result = await reversals.execute({
          purchaseId: purchaseA.purchase.id,
          actorUserId: admin.id,
          reason: "C26 browser fixture correction",
          previewVersion: preview.previewVersion,
          idempotencyKey: randomUUID(),
          priceResolutions: preview.priceEffects.filter((effect) => effect.requiresPriceResolution).map((effect) => {
            if (effect.version === null || effect.currentUnitPrice === null || effect.currency === null) throw new Error("Expected a complete C26 price resolution.");
            return { productId: effect.productId, expectedPriceMasterVersion: effect.version, currentUnitPrice: effect.currentUnitPrice, currency: effect.currency };
          }),
        });
        assert.equal(result.replayed, false);
        const audit = await reversals.readAudit(purchaseA.purchase.id);
        if (audit === null) throw new Error("Expected an immutable C26 reversal audit.");
        return { productId: product.productId, recommendationAId: recommendationA.id, purchaseAId: purchaseA.purchase.id, audit };
      },
      async handoffPurchaseId(recommendationId) {
        const lineage = await handoffs.getLineageBySourceRecommendationId(recommendationId);
        if (lineage === null || lineage === "NOT_FOUND") throw new Error("Expected an immutable Recommendation handoff.");
        return lineage.purchase.id;
      },
      readAudit: (purchaseId) => reversals.readAudit(purchaseId),
    };
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
