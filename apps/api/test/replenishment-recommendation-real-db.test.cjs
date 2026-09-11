const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.REPLENISHMENT_RECOMMENDATION_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c15b_recommendation_test";

if (databaseUrl === undefined) {
  test("replenishment recommendation real database proof is opt-in", { skip: "REPLENISHMENT_RECOMMENDATION_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("replenishment recommendation real database proof requires its dedicated disposable database", () => {
      assert.fail(`REPLENISHMENT_RECOMMENDATION_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("immutable replenishment snapshots persist only READY results, derive freshness, and transition atomically", async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.NODE_ENV = "test";
      process.env.CORS_ORIGIN = "http://localhost:4311";
      process.env.PUBLIC_WEB_BASE_URL = "http://localhost:4311";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:4311";
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
      process.env.LOG_LEVEL = "error";
      process.env.CSRF_LEGACY_SCALAR_FALLBACK = "false";

      const { AppModule } = require("../dist/app.module.js");
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr006c15b-${randomUUID()}`;
      let app;
      const sessionFor = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({ data: {
          userId, tokenHash: hash(token), csrfTokenHash: hash(csrf), credentialVersion: user.credentialVersion,
          authenticationPolicyVersion: user.authenticationPolicyVersion, expiresAt: new Date(Date.now() + 5 * 60_000), activatedAt: new Date(),
        } });
        await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt } });
        return { token, csrf };
      };
      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
        app.use(cookieParser()); app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        return `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
      };

      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "Each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "Supplier" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "5" } });
        await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity: "5", targetStockQuantity: "12" } });
        const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id } });
        await prisma.productSupplyPreference.create({ data: { productId: product.id, relationshipId: relationship.id } });
        await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: relationship.id, minimumOrderQuantity: "10", orderMultipleQuantity: "5" } });
        const packageRow = await prisma.productSupplierPackage.create({ data: { relationshipId: relationship.id, code: "CASE", name: "Case", inventoryQuantityPerPackage: "10", isOrderable: true } });
        await prisma.productSupplierPackagePreference.create({ data: { relationshipId: relationship.id, packageId: packageRow.id } });
        const purchase = await prisma.purchase.create({ data: { supplierId: supplier.id, purchaseDate: new Date("2026-09-12T00:00:00.000Z"), documentNumber: `${fixture}-DRAFT`, items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "4", unitPrice: "1", lineAmount: "4", taxRate: "0" } } } });
        await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "CONFIRMED" } });

        const permissions = await Promise.all(["inventory.read", "purchase.read", "master.read", "replenishment.manage"].map((code) => prisma.permission.findUniqueOrThrow({ where: { code } })));
        const createToken = async (suffix, indexes) => {
          const user = await prisma.user.create({ data: { email: `${fixture}-${suffix}@example.test`, displayName: suffix, passwordHash: "not-used" } });
          const role = await prisma.role.create({ data: { code: `${fixture}-${suffix}`, name: suffix } });
          await prisma.rolePermission.createMany({ data: indexes.map((index) => ({ roleId: role.id, permissionId: permissions[index].id })) });
          await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
          return { user, ...(await sessionFor(user.id, suffix)) };
        };
        const [reader, managerOnly, all] = await Promise.all([createToken("reader", [0, 1, 2]), createToken("manager", [3]), createToken("all", [0, 1, 2, 3])]);
        const baseUrl = await startApp();
        let requestNumber = 0;
        const request = (path, credentials, method = "GET", body = undefined) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, { method, headers: {
            "x-forwarded-for": `127.0.0.${requestNumber}`,
            ...(credentials === undefined ? {} : { cookie: `lotus_session=${credentials.token}` }),
            ...(method === "GET" || credentials === undefined ? {} : { "x-csrf-token": credentials.csrf, "content-type": "application/json" }),
          }, body: body === undefined ? undefined : JSON.stringify(body) });
        };
        const path = `/inventory/${encodeURIComponent(product.id)}/replenishment-recommendation`;
        assert.equal((await request(path)).status, 401);
        assert.equal((await request(path, managerOnly)).status, 403);
        const empty = await request(path, reader); assert.equal(empty.status, 200); assert.equal(empty.headers.get("cache-control"), "private, no-store"); assert.deepEqual(await empty.json(), { recommendation: null });
        assert.equal((await request(path, reader, "POST")).status, 403);
        assert.equal((await request(path, managerOnly, "POST")).status, 403);

        const createdResponse = await request(path, all, "POST"); assert.equal(createdResponse.status, 200);
        const createdBody = await createdResponse.json(); assert.deepEqual(Object.keys(createdBody), ["recommendation"]);
        const created = createdBody.recommendation; assert.equal(created.disposition, "ACTIVE"); assert.equal(created.freshness, "CURRENT");
        assert.equal(created.snapshot.currentQuantity, "5.000000000"); assert.equal(created.snapshot.draftPurchaseQuantity, "0.000000000"); assert.equal(created.snapshot.confirmedPurchaseQuantity, "4.000000000");
        assert.deepEqual(created.snapshot.result, { rawTargetGap: "7.000000000", feasibleQuantity: "10.000000000", overOrderQuantity: "3.000000000", packageCount: "1" });
        const persisted = await prisma.replenishmentRecommendation.findUniqueOrThrow({ where: { id: created.id } });
        assert.equal(persisted.createdByUserId, all.user.id); assert.equal(persisted.disposition, "ACTIVE"); assert.equal(persisted.inventoryVersionSnapshot, 1);
        assert.equal(persisted.packageIdSnapshot, packageRow.id); assert.equal(persisted.supplierIdSnapshot, supplier.id);

        await prisma.inventory.update({ where: { productId: product.id }, data: { quantity: "4", version: { increment: 1 } } });
        const stale = await request(path, reader); assert.equal(stale.status, 200); assert.equal((await stale.json()).recommendation.freshness, "STALE");
        await prisma.replenishmentPolicy.update({ where: { productId: product.id }, data: { targetStockQuantity: null, version: { increment: 1 } } });
        const invalid = await request(path, reader); assert.equal(invalid.status, 200); assert.equal((await invalid.json()).recommendation.freshness, "INVALID");
        assert.equal((await request(path, all, "POST")).status, 409);
        assert.equal((await prisma.replenishmentRecommendation.count({ where: { productId: product.id } })), 1);
        await prisma.replenishmentPolicy.update({ where: { productId: product.id }, data: { targetStockQuantity: "12", version: { increment: 1 } } });

        const recalculatedResponse = await request(path, all, "POST"); assert.equal(recalculatedResponse.status, 200); const recalculated = (await recalculatedResponse.json()).recommendation;
        assert.notEqual(recalculated.id, created.id); assert.equal(recalculated.disposition, "ACTIVE");
        const old = await prisma.replenishmentRecommendation.findUniqueOrThrow({ where: { id: created.id } });
        assert.equal(old.disposition, "SUPERSEDED"); assert.equal(old.version, 2); assert.equal(old.supersededByUserId, all.user.id); assert.ok(old.supersededAt instanceof Date);
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: product.id, disposition: "ACTIVE" } }), 1);

        // A Product row lock serializes two explicit recalculations. Both may
        // complete, but the second must supersede the first rather than leave
        // two active snapshots or overwrite immutable input fields.
        const concurrentProduct = await prisma.product.create({ data: { code: `${fixture}-CONCURRENT`, name: "Concurrent", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        await prisma.inventory.create({ data: { productId: concurrentProduct.id, quantity: "5" } });
        await prisma.replenishmentPolicy.create({ data: { productId: concurrentProduct.id, reorderPointQuantity: "5", targetStockQuantity: "12" } });
        const concurrentRelationship = await prisma.productSupplyRelationship.create({ data: { productId: concurrentProduct.id, supplierId: supplier.id } });
        await prisma.productSupplyPreference.create({ data: { productId: concurrentProduct.id, relationshipId: concurrentRelationship.id } });
        await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: concurrentRelationship.id, minimumOrderQuantity: "10", orderMultipleQuantity: "5" } });
        const concurrentPath = `/inventory/${encodeURIComponent(concurrentProduct.id)}/replenishment-recommendation`;
        const concurrentResponses = await Promise.all([request(concurrentPath, all, "POST"), request(concurrentPath, all, "POST")]);
        assert.deepEqual(concurrentResponses.map((response) => response.status).sort(), [200, 200]);
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: concurrentProduct.id, disposition: "ACTIVE" } }), 1);
        assert.equal(await prisma.replenishmentRecommendation.count({ where: { productId: concurrentProduct.id, disposition: "SUPERSEDED" } }), 1);
        assert.equal((await request(`${path}/${recalculated.id}/dismiss`, all, "POST", { expectedVersion: 2 })).status, 409);
        const dismissedResponse = await request(`${path}/${recalculated.id}/dismiss`, all, "POST", { expectedVersion: 1 }); assert.equal(dismissedResponse.status, 200);
        const dismissed = (await dismissedResponse.json()).recommendation; assert.equal(dismissed.disposition, "DISMISSED"); assert.equal(dismissed.version, 2);
        assert.deepEqual(await (await request(path, reader)).json(), { recommendation: null });
        const terminal = await prisma.replenishmentRecommendation.findUniqueOrThrow({ where: { id: recalculated.id } });
        assert.equal(terminal.dismissedByUserId, all.user.id); assert.equal(terminal.inventoryQuantitySnapshot.toString(), "4"); assert.ok(terminal.dismissedAt instanceof Date);
        await assert.rejects(() => prisma.$executeRawUnsafe('UPDATE "ReplenishmentRecommendation" SET "feasibleQuantitySnapshot" = 999 WHERE "id" = $1', recalculated.id), /immutable/i);
      } finally {
        await app?.close(); await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() }); await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanup.end(); }
      }
    });
  }
}
