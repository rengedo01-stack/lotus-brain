const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const { readDisposableDatabaseUrl } = require("./support/disposable-database.cjs");
const databaseUrl = readDisposableDatabaseUrl("PRICE_PROVENANCE_MIGRATION_COMPATIBILITY_DATABASE_URL");
const allowedDatabaseName = "lotus_brain_pr006c24c1_price_provenance_test";

const legacy = {
  unitId: "legacy-price-provenance-unit",
  productId: "legacy-price-provenance-product",
  supplierId: "legacy-price-provenance-supplier",
  purchaseItemId: "legacy-price-provenance-purchase-item",
  priceMasterId: "legacy-price-provenance-master",
  priceHistoryId: "legacy-price-provenance-history",
};

if (databaseUrl === undefined) {
  test("price provenance migration PostgreSQL proof is opt-in", { skip: "PRICE_PROVENANCE_MIGRATION_COMPATIBILITY_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("price provenance migration proof requires its dedicated disposable database", () => {
      assert.fail(`PRICE_PROVENANCE_MIGRATION_COMPATIBILITY_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { PrismaPurchaseDraftRepository } = require("../dist/modules/purchase/infrastructure/purchase-draft.repository.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("price provenance forward migration preserves unknown legacy source and new purchase posting establishes protected provenance", async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.NODE_ENV = "test";
      process.env.CORS_ORIGIN = "http://localhost:3000";
      process.env.PUBLIC_WEB_BASE_URL = "http://localhost:3000";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
      process.env.LOG_LEVEL = "error";
      process.env.CSRF_LEGACY_SCALAR_FALLBACK = "false";

      const { AppModule } = require("../dist/app.module.js");
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `c24c1-${randomUUID()}`;
      const sessionToken = `${fixture}-session`;
      const csrfToken = `${fixture}-csrf`;
      const raw = new Client({ connectionString: databaseUrl });
      let app;

      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        return `http://127.0.0.1:${address.port}`;
      };

      try {
        const legacyMaster = await prisma.priceMaster.findUniqueOrThrow({
          where: { id: legacy.priceMasterId },
          include: { priceHistories: true },
        });
        assert.equal(legacyMaster.currentPriceHistoryId, null);
        assert.equal(legacyMaster.version, 1);
        assert.equal(legacyMaster.currentUnitPrice.toString(), "7000");
        assert.equal(legacyMaster.currency, "JPY");
        assert.equal(legacyMaster.currentPriceEffectiveAt.toISOString(), "2026-09-01T00:00:00.000Z");
        assert.equal(legacyMaster.priceHistories.length, 1);
        const legacyHistory = legacyMaster.priceHistories[0];
        assert.ok(legacyHistory);
        assert.equal(legacyHistory.id, legacy.priceHistoryId);
        assert.equal(legacyHistory.eventType, "LEGACY_UNKNOWN");
        assert.equal(legacyHistory.sourcePurchaseItemId, legacy.purchaseItemId);
        assert.equal(legacyHistory.inventoryUnitId, legacy.unitId);
        assert.equal(legacyHistory.unitPrice.toString(), "7000");
        assert.equal(legacyHistory.currency, "JPY");
        assert.equal(legacyHistory.effectiveAt.toISOString(), "2026-09-01T00:00:00.000Z");
        assert.equal(await prisma.inventory.count({ where: { productId: legacy.productId } }), 0);
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: legacy.productId } }), 0);

        const relationship = await prisma.productSupplyRelationship.create({
          data: { productId: legacy.productId, supplierId: legacy.supplierId, status: "ACTIVE" },
        });
        const commercialTerms = await prisma.productSupplierCommercialTerms.create({
          data: { relationshipId: relationship.id, unitPrice: "6900", currencyCode: "JPY", taxRate: "0.1" },
        });

        const user = await prisma.user.create({
          data: { email: `${fixture}@example.test`, displayName: "C24C-1 migration tester", passwordHash: "not-used" },
        });
        await prisma.userRole.create({ data: { userId: user.id, roleId: "rbac-role-system-admin" } });
        const session = await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hash(sessionToken),
            csrfTokenHash: hash(csrfToken),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 60_000),
            activatedAt: new Date(),
          },
        });
        await prisma.identityCsrfToken.create({
          data: { identitySessionId: session.id, tokenHash: hash(csrfToken), expiresAt: session.expiresAt },
        });

        const draftRepository = new PrismaPurchaseDraftRepository(prisma);
        const draft = await draftRepository.create({
          supplierId: legacy.supplierId,
          purchaseDate: "2026-09-02T00:00:00.000Z",
          documentNumber: `${fixture}-new-observation`,
          items: [{ productId: legacy.productId, unitId: legacy.unitId, quantity: "2.000000000", unitPrice: "7500.000000", taxRate: "0" }],
        });
        assert.notEqual(await draftRepository.confirm(draft.id), "NOT_FOUND");

        const baseUrl = await startApp();
        const response = await fetch(`${baseUrl}/api/v1/purchases/${draft.id}/post`, {
          method: "POST",
          headers: { cookie: `lotus_session=${sessionToken}`, "x-forwarded-for": "127.0.0.1", "x-csrf-token": csrfToken },
        });
        assert.equal(response.status, 200);

        const postedItem = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: draft.id } });
        const postedHistory = await prisma.priceHistory.findUniqueOrThrow({ where: { sourcePurchaseItemId: postedItem.id } });
        const sourcedMaster = await prisma.priceMaster.findUniqueOrThrow({ where: { id: legacy.priceMasterId } });
        assert.equal(postedHistory.eventType, "PURCHASE_POSTING");
        assert.equal(postedHistory.priceMasterId, sourcedMaster.id);
        assert.equal(postedHistory.unitPrice.toString(), "7500");
        assert.equal(sourcedMaster.currentPriceHistoryId, postedHistory.id);
        assert.equal(sourcedMaster.currentUnitPrice.toString(), "7500");
        assert.equal(sourcedMaster.currentPriceEffectiveAt.toISOString(), "2026-09-02T00:00:00.000Z");
        assert.equal(sourcedMaster.version, 2);
        const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: legacy.productId } });
        assert.equal(inventory.quantity.toString(), "2");
        assert.equal(inventory.averageUnitCost.toString(), "7500");
        assert.deepEqual(
          await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { id: commercialTerms.id } }),
          commercialTerms,
        );
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: legacy.productId } }), 0);

        await raw.connect();
        await assert.rejects(
          () => raw.query('UPDATE "PriceHistory" SET "note" = $1 WHERE "id" = $2', ["rewrite", postedHistory.id]),
          /append-only/i,
        );
        await assert.rejects(
          () => raw.query('DELETE FROM "PriceHistory" WHERE "id" = $1', [postedHistory.id]),
          /append-only/i,
        );

        const otherSupplier = await prisma.supplier.create({
          data: { code: `${fixture}-other-supplier`, name: "C24C-1 other supplier" },
        });
        const otherMaster = await prisma.priceMaster.create({
          data: { productId: legacy.productId, supplierId: otherSupplier.id, currentUnitPrice: "8000", currency: "JPY" },
        });
        const otherHistory = await prisma.priceHistory.create({
          data: {
            priceMasterId: otherMaster.id,
            eventType: "LEGACY_UNKNOWN",
            inventoryUnitId: legacy.unitId,
            unitPrice: "8000",
            currency: "JPY",
            effectiveAt: new Date("2026-09-03T00:00:00.000Z"),
          },
        });
        await assert.rejects(
          () => prisma.priceMaster.update({
            where: { id: sourcedMaster.id },
            data: { currentPriceHistoryId: otherHistory.id, version: { increment: 1 } },
          }),
          /same PriceMaster/i,
        );

        const mismatchedHistory = await prisma.priceHistory.create({
          data: {
            priceMasterId: sourcedMaster.id,
            eventType: "LEGACY_UNKNOWN",
            inventoryUnitId: legacy.unitId,
            unitPrice: "8001",
            currency: "JPY",
            effectiveAt: new Date("2026-09-03T00:00:00.000Z"),
          },
        });
        await assert.rejects(
          () => prisma.priceMaster.update({
            where: { id: sourcedMaster.id },
            data: { currentPriceHistoryId: mismatchedHistory.id, version: { increment: 1 } },
          }),
          /current price snapshot/i,
        );
        await assert.rejects(
          () => prisma.priceMaster.update({
            where: { id: sourcedMaster.id },
            data: { currentUnitPrice: "7600" },
          }),
          /version must increment exactly once/i,
        );
        await assert.rejects(
          () => prisma.priceMaster.update({
            where: { id: sourcedMaster.id },
            data: { version: { increment: 1 } },
          }),
          /only with a current-state change/i,
        );
        const protectedMaster = await prisma.priceMaster.findUniqueOrThrow({ where: { id: sourcedMaster.id } });
        assert.equal(protectedMaster.currentPriceHistoryId, postedHistory.id);
        assert.equal(protectedMaster.currentUnitPrice.toString(), "7500");
        assert.equal(protectedMaster.version, 2);
      } finally {
        await raw.end();
        await app?.close();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanupClient = new Client({ connectionString: cleanupUrl.toString() });
        await cleanupClient.connect();
        try {
          await cleanupClient.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`);
        } finally {
          await cleanupClient.end();
        }
      }
    });
  }
}
