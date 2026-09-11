const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.STOCKTAKE_POSTING_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr005y_stocktake_posting_test";

if (databaseUrl === undefined) {
  test("stocktake posting HTTP real database proof is opt-in", { skip: "STOCKTAKE_POSTING_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("stocktake posting HTTP real database proof requires its dedicated disposable database", () => {
      assert.fail(`STOCKTAKE_POSTING_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { PrismaStocktakeRepository } = require("../dist/modules/stocktake/infrastructure/prisma-stocktake.repository.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("stocktake PostgreSQL and HTTP proof preserves exact posting authority and one-time effects", async () => {
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
      const fixture = `pr005y-stocktake-${randomUUID()}`;
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
          data: { code: `${fixture}-unit`, name: "PR-005Y unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: { code: `${fixture}-product`, name: "PR-005Y product", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" },
        });
        const initialInventory = await prisma.inventory.create({ data: { productId: product.id, quantity: "10.000000000", averageUnitCost: "100.000000" } });
        assert.equal(initialInventory.version, 1);

        const user = await prisma.user.create({
          data: { email: `${fixture}@example.test`, displayName: "PR-005Y stocktake tester", passwordHash: "not-used" },
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

        const repository = new PrismaStocktakeRepository(prisma);
        const draft = await repository.create({
          note: "PR-005Y exact post response proof",
          items: [{ productId: product.id, countedQuantity: "12.345678901" }],
        });
        const confirmed = await repository.confirm(draft.id);
        assert.notEqual(confirmed, "NOT_FOUND");
        assert.notEqual(confirmed, "CONFLICT");
        assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } })).version, 1);

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
        assert.equal((await fetch(`${baseUrl}/api/v1/stocktakes/${draft.id}/post`, { method: "POST" })).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/v1/stocktakes/${draft.id}/post`, {
          method: "POST",
          headers: { cookie: `lotus_session=${sessionToken}` },
        })).status, 403);

        const response = await request(`/stocktakes/${draft.id}/post`, { method: "POST" });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ["completedAt", "id", "status"]);
        assert.equal(body.id, draft.id);
        assert.equal(body.status, "POSTED");
        assert.equal(new Date(body.completedAt).toISOString(), body.completedAt);

        const posted = await prisma.stocktake.findUniqueOrThrow({ where: { id: draft.id } });
        assert.equal(posted.status, "POSTED");
        assert.equal(posted.completedAt.toISOString(), body.completedAt);
        const adjustment = await prisma.inventoryAdjustment.findUniqueOrThrow({ where: { stocktakeId: draft.id } });
        assert.equal(adjustment.status, "POSTED");
        assert.equal(await prisma.inventoryAdjustmentItem.count({ where: { adjustmentId: adjustment.id } }), 1);
        assert.equal(await prisma.inventoryHistory.count({ where: { sourceInventoryAdjustmentItem: { adjustmentId: adjustment.id }, type: "STOCKTAKE_ADJUSTMENT" } }), 1);
        const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
        assert.equal(inventory.quantity.toString(), "12.345678901");
        assert.equal(inventory.version, 2);

        assert.equal((await request(`/stocktakes/${draft.id}/post`, { method: "POST" })).status, 409);
        assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } })).version, 2);
        assert.equal(await prisma.inventoryAdjustment.count({ where: { stocktakeId: draft.id } }), 1);
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
