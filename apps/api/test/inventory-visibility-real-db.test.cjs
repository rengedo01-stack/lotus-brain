const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.INVENTORY_VISIBILITY_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006a_inventory_visibility_test";

if (databaseUrl === undefined) {
  test("inventory visibility real database proof is opt-in", { skip: "INVENTORY_VISIBILITY_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("inventory visibility real database proof requires its dedicated disposable database", () => {
      assert.fail(`INVENTORY_VISIBILITY_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("inventory visibility HTTP proof preserves permission boundaries, exact views, keyset history, and index usability", async () => {
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
      const fixture = `pr006a-${randomUUID()}`;
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
            expiresAt: new Date(Date.now() + 60_000),
            activatedAt: new Date(),
          },
        });
        await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt } });
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
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-unit`, name: "PR-006A unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const createProduct = (suffix, state = {}) => prisma.product.create({
          data: {
            code: `${fixture}-${suffix}`,
            name: `PR-006A ${suffix}`,
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
            ...state,
          },
        });
        const activeProduct = await createProduct("A-ACTIVE");
        const inactiveProduct = await createProduct("B-INACTIVE", { status: "INACTIVE" });
        const deletedProduct = await createProduct("C-DELETED", { status: "INACTIVE", deletedAt: new Date("2026-09-08T00:00:00.000Z") });
        const emptyProduct = await createProduct("D-EMPTY");
        const noInventoryProduct = await createProduct("E-NO-INVENTORY");
        const activeInventory = await prisma.inventory.create({ data: { productId: activeProduct.id, quantity: "12.345678901", averageUnitCost: "999.000000" } });
        await prisma.inventory.create({ data: { productId: inactiveProduct.id, quantity: "0", averageUnitCost: null } });
        await prisma.inventory.create({ data: { productId: deletedProduct.id, quantity: "-3.500000000", averageUnitCost: "100.000000" } });
        await prisma.inventory.create({ data: { productId: emptyProduct.id, quantity: "0", averageUnitCost: null } });
        const occurredAt = new Date("2026-09-08T01:02:03.004Z");
        await prisma.inventoryHistory.createMany({
          data: [
            { id: `${fixture}-history-01`, inventoryId: activeInventory.id, inventoryUnitId: unit.id, type: "RECEIPT", quantityDelta: "5.000000000", quantityAfter: "5.000000000", occurredAt },
            { id: `${fixture}-history-02`, inventoryId: activeInventory.id, inventoryUnitId: unit.id, type: "MANUAL_ADJUSTMENT", quantityDelta: "7.345678901", quantityAfter: "12.345678901", occurredAt },
            { id: `${fixture}-history-03`, inventoryId: activeInventory.id, inventoryUnitId: unit.id, type: "CONSUMPTION", quantityDelta: "-1.000000000", quantityAfter: "11.345678901", occurredAt: new Date("2026-09-07T01:02:03.004Z") },
          ],
        });

        const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006A admin", passwordHash: "not-used" } });
        const legacy = await prisma.user.create({ data: { email: `${fixture}-legacy@example.test`, displayName: "PR-006A legacy", passwordHash: "not-used" } });
        await prisma.userRole.createMany({
          data: [
            { userId: admin.id, roleId: "rbac-role-system-admin" },
            { userId: legacy.id, roleId: "rbac-role-legacy-authenticated" },
          ],
        });
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "inventory.read" } });
        assert.ok(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: permission.id } } }));
        assert.equal(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: "rbac-role-legacy-authenticated", permissionId: permission.id } } }), null);

        const adminToken = await createSession(admin.id, "admin");
        const legacyToken = await createSession(legacy.id, "legacy");
        const baseUrl = await startApp();
        let requestNumber = 0;
        const get = (path, token) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, {
            headers: {
              "x-forwarded-for": `127.0.0.${requestNumber}`,
              ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }),
            },
          });
        };

        assert.equal((await get("/inventory")).status, 401);
        assert.equal((await get("/inventory", legacyToken)).status, 403);

        const currentResponse = await get("/inventory?limit=2", adminToken);
        assert.equal(currentResponse.status, 200);
        const current = await currentResponse.json();
        assert.deepEqual(Object.keys(current).sort(), ["items", "nextCursor"]);
        assert.equal(current.items.length, 2);
        assert.ok(current.items.every((item) => Object.keys(item).sort().join(",") === "inventoryUnit,product,quantity,updatedAt"));
        assert.ok(current.items.every((item) => !JSON.stringify(item).match(/averageUnitCost|sourcePurchaseItemId|sourceProductionId|note|currency|price/i)));
        assert.deepEqual(current.items.map((item) => item.product.code), [`${fixture}-A-ACTIVE`, `${fixture}-B-INACTIVE`]);
        assert.equal(current.items[0].quantity, "12.345678901");
        assert.equal(current.items[0].product.isDeleted, false);
        assert.equal(typeof current.nextCursor, "string");

        const nextCurrent = await get(`/inventory?limit=2&cursor=${encodeURIComponent(current.nextCursor)}`, adminToken);
        assert.equal(nextCurrent.status, 200);
        const nextCurrentBody = await nextCurrent.json();
        assert.deepEqual(nextCurrentBody.items.map((item) => item.product.code), [`${fixture}-C-DELETED`, `${fixture}-D-EMPTY`]);
        assert.equal(nextCurrentBody.items[0].product.isDeleted, true);
        assert.equal(nextCurrentBody.items.some((item) => item.product.id === noInventoryProduct.id), false);
        assert.equal((await get(`/inventory?limit=2&productCode=${encodeURIComponent(`${fixture}-A-ACTIVE`)}&cursor=${encodeURIComponent(current.nextCursor)}`, adminToken)).status, 400);

        const filtered = await get(`/inventory?limit=50&productCode=${encodeURIComponent(`${fixture}-A-ACTIVE`)}`, adminToken);
        assert.equal(filtered.status, 200);
        assert.deepEqual((await filtered.json()).items.map((item) => item.product.id), [activeProduct.id]);

        const historyResponse = await get(`/inventory/${activeProduct.id}/history?limit=2`, adminToken);
        assert.equal(historyResponse.status, 200);
        const history = await historyResponse.json();
        assert.deepEqual(Object.keys(history).sort(), ["currentInventory", "items", "nextCursor"]);
        assert.deepEqual(history.items.map((item) => item.id), [`${fixture}-history-02`, `${fixture}-history-01`]);
        assert.equal(history.currentInventory.quantity, "12.345678901");
        assert.ok(history.items.every((item) => Object.keys(item).sort().join(",") === "id,inventoryUnit,occurredAt,quantityAfter,quantityDelta,type"));
        assert.ok(history.items.every((item) => !JSON.stringify(item).match(/source|note|cost|price|currency/i)));
        assert.equal(typeof history.nextCursor, "string");

        const nextHistoryResponse = await get(`/inventory/${activeProduct.id}/history?limit=2&cursor=${encodeURIComponent(history.nextCursor)}`, adminToken);
        assert.equal(nextHistoryResponse.status, 200);
        assert.deepEqual((await nextHistoryResponse.json()).items.map((item) => item.id), [`${fixture}-history-03`]);
        assert.equal((await get(`/inventory/${activeProduct.id}/history?limit=2&type=RECEIPT&cursor=${encodeURIComponent(history.nextCursor)}`, adminToken)).status, 400);
        const inclusive = await get(`/inventory/${activeProduct.id}/history?limit=50&from=${encodeURIComponent(occurredAt.toISOString())}&to=${encodeURIComponent(occurredAt.toISOString())}`, adminToken);
        assert.equal(inclusive.status, 200);
        assert.deepEqual((await inclusive.json()).items.map((item) => item.id), [`${fixture}-history-02`, `${fixture}-history-01`]);
        assert.equal((await get(`/inventory/${emptyProduct.id}/history?limit=50`, adminToken)).status, 200);
        assert.equal((await (await get(`/inventory/${emptyProduct.id}/history?limit=50`, adminToken)).json()).items.length, 0);
        assert.equal((await get(`/inventory/${noInventoryProduct.id}/history?limit=50`, adminToken)).status, 404);
        assert.equal((await get(`/inventory/${activeProduct.id}/history?limit=50&from=2026-09-09T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z`, adminToken)).status, 400);

        const planRows = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT "id" FROM "InventoryHistory" WHERE "inventoryId" = '${activeInventory.id}' AND "type" = 'RECEIPT' ORDER BY "occurredAt" DESC, "id" DESC LIMIT 2`);
        });
        assert.match(JSON.stringify(planRows), /InventoryHistory_inventoryId_type_occurredAt_id_desc_idx/);
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
