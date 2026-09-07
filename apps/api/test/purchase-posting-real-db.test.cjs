const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PURCHASE_POSTING_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr005x_purchase_posting_test";

if (databaseUrl === undefined) {
  test("purchase posting real database proof is opt-in", { skip: "PURCHASE_POSTING_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("purchase posting real database proof requires its dedicated disposable database", () => {
      assert.fail(`PURCHASE_POSTING_DATABASE_URL must target ${allowedDatabaseName}.`);
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

    test("purchase PostgreSQL and HTTP proof preserves exact posting authority, effects, and one-time semantics", async () => {
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
      const fixture = `pr005x-${randomUUID()}`;
      const sessionToken = `${fixture}-session`;
      const csrfToken = `${fixture}-csrf`;
      let app;

      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        return `http://127.0.0.1:${address.port}`;
      };

      try {
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-unit`, name: "PR-005X unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: {
            code: `${fixture}-product`,
            name: "PR-005X product",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            status: "ACTIVE",
          },
        });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "0", averageUnitCost: null } });
        const supplier = await prisma.supplier.create({
          data: { code: `${fixture}-supplier`, name: "PR-005X supplier", status: "ACTIVE" },
        });
        const user = await prisma.user.create({
          data: { email: `${fixture}@example.test`, displayName: "PR-005X tester", passwordHash: "not-used" },
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

        const repository = new PrismaPurchaseDraftRepository(prisma);
        const createConfirmedPurchase = async (documentNumber) => {
          const draft = await repository.create({
            supplierId: supplier.id,
            purchaseDate: "2026-09-03T00:00:00.000Z",
            documentNumber,
            items: [{ productId: product.id, unitId: unit.id, quantity: "2.500000000", unitPrice: "120.000000", taxRate: "0.1" }],
          });
          const confirmed = await repository.confirm(draft.id);
          assert.notEqual(confirmed, "NOT_FOUND");
          assert.notEqual(confirmed, "CONFLICT");
          return draft;
        };

        const baseUrl = await startApp();
        const request = (path, options = {}) => {
          const method = options.method ?? "GET";
          return fetch(`${baseUrl}/api/v1${path}`, {
            method,
            headers: {
              cookie: `lotus_session=${sessionToken}`,
              ...(method === "GET" ? {} : { "x-csrf-token": csrfToken }),
            },
          });
        };

        assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
        const purchase = await createConfirmedPurchase(`${fixture}-success`);
        assert.equal((await fetch(`${baseUrl}/api/v1/purchases/${purchase.id}/post`, { method: "POST" })).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/v1/purchases/${purchase.id}/post`, {
          method: "POST",
          headers: { cookie: `lotus_session=${sessionToken}` },
        })).status, 403);

        const response = await request(`/purchases/${purchase.id}/post`, { method: "POST" });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ["id", "postedAt", "status"]);
        assert.deepEqual(body.id, purchase.id);
        assert.deepEqual(body.status, "POSTED");
        assert.equal(new Date(body.postedAt).toISOString(), body.postedAt);

        const posted = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true } });
        assert.equal(posted.status, "POSTED");
        assert.equal(posted.postedAt.toISOString(), body.postedAt);
        const sourceItem = posted.items[0];
        assert.ok(sourceItem);
        assert.equal(await prisma.priceHistory.count({ where: { sourcePurchaseItemId: sourceItem.id } }), 1);
        assert.equal(await prisma.inventoryHistory.count({ where: { sourcePurchaseItemId: sourceItem.id, type: "RECEIPT" } }), 1);
        const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
        assert.equal(inventory.quantity.toString(), "2.5");
        assert.equal(inventory.averageUnitCost.toString(), "120");
        assert.equal(await prisma.purchaseLog.count({ where: { purchaseId: purchase.id, toStatus: "POSTED" } }), 1);

        assert.equal((await request(`/purchases/${purchase.id}/post`, { method: "POST" })).status, 409);
        assert.equal(await prisma.priceHistory.count({ where: { sourcePurchaseItemId: sourceItem.id } }), 1);
        assert.equal(await prisma.inventoryHistory.count({ where: { sourcePurchaseItemId: sourceItem.id, type: "RECEIPT" } }), 1);

        const rollbackPurchase = await createConfirmedPurchase(`${fixture}-rollback`);
        const rollbackItem = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: rollbackPurchase.id } });
        const functionName = `pr005x_purchase_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."sourcePurchaseItemId" = '${rollbackItem.id}' THEN RAISE EXCEPTION 'forced purchase posting failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "InventoryHistory" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        try {
          assert.equal((await request(`/purchases/${rollbackPurchase.id}/post`, { method: "POST" })).status, 500);
          assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: rollbackPurchase.id } })).status, "CONFIRMED");
          assert.equal(await prisma.priceHistory.count({ where: { sourcePurchaseItemId: rollbackItem.id } }), 0);
          assert.equal(await prisma.inventoryHistory.count({ where: { sourcePurchaseItemId: rollbackItem.id } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "InventoryHistory";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }
      } finally {
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
