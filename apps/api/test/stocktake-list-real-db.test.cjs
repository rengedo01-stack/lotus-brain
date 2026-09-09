const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.STOCKTAKE_LIST_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006b3_stocktake_list_test";

if (databaseUrl === undefined) {
  test("stocktake list real database proof is opt-in", { skip: "STOCKTAKE_LIST_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("stocktake list real database proof requires its dedicated disposable database", () => {
      assert.fail(`STOCKTAKE_LIST_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("stocktake list HTTP proof preserves header-only reads, permissions, bound keysets, and list indexes", async () => {
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
      const fixture = `b3-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      let app;

      const createSession = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({
          data: {
            userId,
            tokenHash: hash(token),
            csrfTokenHash: hash(csrf),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 5 * 60_000),
            activatedAt: new Date(),
          },
        });
        await prisma.identityCsrfToken.create({
          data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt },
        });
        return token;
      };

      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        return `http://127.0.0.1:${address.port}/api/v1`;
      };

      try {
        const sharedCreatedAt = new Date("2026-09-08T00:00:00.000Z");
        const olderCreatedAt = new Date("2026-09-07T00:00:00.000Z");
        const primary = await prisma.stocktake.create({
          data: { id: `${fixture}-stocktake-003`, status: "POSTED", startedAt: new Date("2026-09-08T00:05:00.000Z"), completedAt: new Date("2026-09-08T01:00:00.000Z"), note: "must never be listed", createdAt: sharedCreatedAt, updatedAt: sharedCreatedAt },
        });
        await prisma.stocktake.createMany({
          data: [
            { id: `${fixture}-stocktake-002`, status: "CONFIRMED", startedAt: new Date("2026-09-08T00:02:00.000Z"), note: "hidden", createdAt: sharedCreatedAt, updatedAt: sharedCreatedAt },
            { id: `${fixture}-stocktake-001`, status: "DRAFT", note: "hidden", createdAt: sharedCreatedAt, updatedAt: sharedCreatedAt },
            { id: `${fixture}-stocktake-older`, status: "CANCELLED", note: "hidden", createdAt: olderCreatedAt, updatedAt: olderCreatedAt },
          ],
        });

        // A StocktakeItem may reference an inactive, renamed Product, but the
        // list must neither join it nor reveal any Product/Inventory data.
        const unit = await prisma.unit.create({ data: { code: `${fixture}-u`, name: "PR-006B3 unit", symbol: "u", dimension: "COUNT", status: "ACTIVE" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-product`, name: "Historical stocktake product", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" } });
        await prisma.stocktakeItem.create({ data: { stocktakeId: primary.id, productId: product.id, inventoryUnitId: unit.id, systemQuantitySnapshot: "9.000000000", countedQuantity: "8.000000000", differenceQuantity: "-1.000000000", note: "hidden item note" } });
        await prisma.product.update({ where: { id: product.id }, data: { code: `${fixture}-renamed`, name: "Current Product Master name must not be listed", status: "INACTIVE", deletedAt: new Date("2026-09-09T00:00:00.000Z") } });

        await prisma.stocktake.createMany({
          data: Array.from({ length: 5_000 }, (_, index) => ({
            id: `${fixture}-index-${String(index).padStart(4, "0")}`,
            status: index % 10 === 0 ? "CONFIRMED" : "DRAFT",
            startedAt: index % 10 === 0 ? new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60, index % 1_000)) : null,
            createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60, index % 1_000)),
            updatedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60, index % 1_000)),
          })),
        });

        const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006B3 admin", passwordHash: "not-used" } });
        const denied = await prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "PR-006B3 denied", passwordHash: "not-used" } });
        const noReadRole = await prisma.role.create({ data: { code: `${fixture}-no-stocktake-read`, name: "PR-006B3 no stocktake read" } });
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: "rbac-role-system-admin" },
          { userId: denied.id, roleId: noReadRole.id },
        ] });
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "stocktake.read" } });
        assert.ok(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: permission.id } } }));
        assert.equal(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: noReadRole.id, permissionId: permission.id } } }), null);

        const adminToken = await createSession(admin.id, "admin");
        const deniedToken = await createSession(denied.id, "denied");
        const baseUrl = await startApp();
        assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
        let requestNumber = 0;
        const get = (path, token) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, {
            headers: { "x-forwarded-for": `127.0.0.${requestNumber}`, ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }) },
          });
        };

        assert.equal((await get("/stocktakes")).status, 401);
        assert.equal((await get("/stocktakes", deniedToken)).status, 403);

        const createdFrom = "2026-09-07T00%3A00%3A00.000Z";
        const firstResponse = await get(`/stocktakes?limit=2&createdFrom=${createdFrom}`, adminToken);
        assert.equal(firstResponse.status, 200);
        assert.equal(firstResponse.headers.get("cache-control"), "private, no-store");
        const first = await firstResponse.json();
        assert.deepEqual(Object.keys(first).sort(), ["items", "nextCursor"]);
        assert.deepEqual(first.items.map((item) => item.id), [`${fixture}-stocktake-003`, `${fixture}-stocktake-002`]);
        assert.equal(typeof first.nextCursor, "string");
        assert.ok(first.items.every((item) => Object.keys(item).sort().join(",") === "completedAt,createdAt,id,startedAt,status,updatedAt"));
        assert.equal(JSON.stringify(first).match(/Current Product Master|productId|inventory|quantity|difference|note|adjustment|amount|cost|currency/i), null);

        const nextResponse = await get(`/stocktakes?limit=2&createdFrom=${createdFrom}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken);
        assert.equal(nextResponse.status, 200);
        const next = await nextResponse.json();
        assert.deepEqual(next.items.map((item) => item.id), [`${fixture}-stocktake-001`, `${fixture}-stocktake-older`]);
        assert.equal(next.nextCursor, null);

        const statusResponse = await get("/stocktakes?status=CONFIRMED", adminToken);
        assert.equal(statusResponse.status, 200);
        assert.deepEqual((await statusResponse.json()).items.map((item) => item.id).includes(`${fixture}-stocktake-002`), true);
        const dateResponse = await get("/stocktakes?createdFrom=2026-09-08T00%3A00%3A00.000Z&createdTo=2026-09-08T00%3A00%3A00.000Z", adminToken);
        assert.equal(dateResponse.status, 200);
        assert.deepEqual((await dateResponse.json()).items.slice(0, 3).map((item) => item.id), [`${fixture}-stocktake-003`, `${fixture}-stocktake-002`, `${fixture}-stocktake-001`]);

        assert.equal((await get(`/stocktakes?limit=2&status=DRAFT&createdFrom=${createdFrom}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken)).status, 400);
        assert.equal((await get("/stocktakes?cursor=not-a-cursor", adminToken)).status, 400);
        assert.equal((await get("/stocktakes?createdFrom=2026-09-08", adminToken)).status, 400);
        assert.equal((await get("/stocktakes?createdFrom=2026-09-09T00%3A00%3A00.000Z&createdTo=2026-09-08T00%3A00%3A00.000Z", adminToken)).status, 400);

        await prisma.$executeRawUnsafe('ANALYZE "Stocktake"');
        const byCreatedPlan = await prisma.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT "id" FROM "Stocktake" ORDER BY "createdAt" DESC, "id" DESC LIMIT 50');
        assert.match(JSON.stringify(byCreatedPlan), /Stocktake_createdAt_id_desc_idx/);
        const byStatusPlan = await prisma.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT "id" FROM "Stocktake" WHERE "status" = \'CONFIRMED\' ORDER BY "createdAt" DESC, "id" DESC LIMIT 50');
        assert.match(JSON.stringify(byStatusPlan), /Stocktake_status_createdAt_id_desc_idx/);
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
