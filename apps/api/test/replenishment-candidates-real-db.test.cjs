const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.REPLENISHMENT_CANDIDATE_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c4_candidate_test";

if (databaseUrl === undefined) {
  test("replenishment candidate real database proof is opt-in", { skip: "REPLENISHMENT_CANDIDATE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("replenishment candidate real database proof requires its dedicated disposable database", () => {
      assert.fail(`REPLENISHMENT_CANDIDATE_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("replenishment candidates are a precise three-permission, Decimal predicate over current inventory and current policy", async () => {
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
      const fixture = `pr006c4-${randomUUID()}`;
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
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "PR-006C4 each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const createProduct = async (suffix, quantity, reorderPointQuantity, options = {}) => {
          const { targetStockQuantity, ...productOptions } = options;
          const product = await prisma.product.create({
            data: {
              code: `${fixture}-${suffix}`,
              name: `PR-006C4 ${suffix}`,
              baseUnitId: unit.id,
              inventoryUnitId: unit.id,
              ...productOptions,
            },
          });
          if (quantity !== null) await prisma.inventory.create({ data: { productId: product.id, quantity } });
          if (reorderPointQuantity !== null) await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity, targetStockQuantity: targetStockQuantity ?? null } });
          return product;
        };
        const exact = await createProduct("A-EXACT", "5.000000000", "5.000000000", { targetStockQuantity: "100.000000000" });
        const below = await createProduct("B-BELOW", "4.999000000", "5.000000000");
        const above = await createProduct("C-ABOVE", "5.001000000", "5.000000000");
        const zero = await createProduct("D-ZERO", "0", "0");
        const positiveAtZero = await createProduct("E-POSITIVE-ZERO", "0.001000000", "0");
        const unset = await createProduct("F-UNSET", "0", null);
        const noInventory = await createProduct("G-NO-INVENTORY", null, "99");
        const inactive = await createProduct("H-INACTIVE", "0", "5", { status: "INACTIVE" });
        const deleted = await createProduct("I-DELETED", "0", "5", { deletedAt: new Date("2026-09-09T00:00:00.000Z") });

        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "PR-006C4 supplier" } });
        const createPurchase = async (suffix, productId, quantity, status) => {
          const purchase = await prisma.purchase.create({
            data: {
              id: `${fixture}-${suffix}`,
              supplierId: supplier.id,
              purchaseDate: new Date("2026-09-09T00:00:00.000Z"),
              documentNumber: `${fixture}-${suffix}`,
              items: { create: { productId, unitId: unit.id, lineNumber: 1, quantity, unitPrice: "1.000000", lineAmount: quantity, taxRate: "0" } },
            },
          });
          if (status === "CONFIRMED") await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "CONFIRMED" } });
          if (status === "POSTED") await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "POSTED", postedAt: new Date("2026-09-09T01:00:00.000Z") } });
          if (status === "CANCELLED") await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "CANCELLED", cancelledAt: new Date("2026-09-09T01:00:00.000Z") } });
        };
        await createPurchase("DRAFT-1", exact.id, "1.250000000", "DRAFT");
        await createPurchase("DRAFT-2", exact.id, "2.750000000", "DRAFT");
        await createPurchase("CONFIRMED-LARGE", exact.id, "100.000000000", "CONFIRMED");
        await createPurchase("POSTED", exact.id, "9.000000000", "POSTED");
        await createPurchase("CANCELLED", exact.id, "11.000000000", "CANCELLED");

        const permissions = await Promise.all(["inventory.read", "purchase.read", "master.read"].map((code) => prisma.permission.findUniqueOrThrow({ where: { code } })));
        const createUserWithPermissions = async (suffix, permissionIndexes) => {
          const user = await prisma.user.create({ data: { email: `${fixture}-${suffix}@example.test`, displayName: `PR-006C4 ${suffix}`, passwordHash: "not-used" } });
          if (permissionIndexes.length === 3) {
            await prisma.userRole.create({ data: { userId: user.id, roleId: "rbac-role-system-admin" } });
          } else {
            const role = await prisma.role.create({ data: { code: `${fixture}-${suffix}`, name: `PR-006C4 ${suffix}` } });
            await prisma.rolePermission.createMany({ data: permissionIndexes.map((index) => ({ roleId: role.id, permissionId: permissions[index].id })) });
            await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
          }
          return createSession(user.id, suffix);
        };
        const [allToken, inventoryToken, purchaseToken, masterToken, inventoryPurchaseToken, inventoryMasterToken, purchaseMasterToken] = await Promise.all([
          createUserWithPermissions("all", [0, 1, 2]),
          createUserWithPermissions("inventory", [0]),
          createUserWithPermissions("purchase", [1]),
          createUserWithPermissions("master", [2]),
          createUserWithPermissions("inventory-purchase", [0, 1]),
          createUserWithPermissions("inventory-master", [0, 2]),
          createUserWithPermissions("purchase-master", [1, 2]),
        ]);
        const baseUrl = await startApp();
        let requestNumber = 0;
        const get = (path, token) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, { headers: { "x-forwarded-for": `127.0.0.${requestNumber}`, ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }) } });
        };

        assert.equal((await get("/inventory/replenishment-candidates")).status, 401);
        for (const token of [inventoryToken, purchaseToken, masterToken, inventoryPurchaseToken, inventoryMasterToken, purchaseMasterToken]) {
          assert.equal((await get("/inventory/replenishment-candidates", token)).status, 403);
        }

        const response = await get("/inventory/replenishment-candidates?limit=50", allToken);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ["items", "nextCursor"]);
        const exactItem = body.items.find((item) => item.product.id === exact.id);
        assert.ok(exactItem);
        assert.deepEqual(Object.keys(exactItem).sort(), ["confirmedPurchaseQuantity", "currentQuantity", "draftPurchaseQuantity", "inventoryUnit", "product", "reorderPointQuantity"]);
        assert.deepEqual(Object.keys(exactItem.product).sort(), ["code", "id", "name"]);
        assert.equal(exactItem.currentQuantity, "5");
        assert.equal(exactItem.reorderPointQuantity, "5");
        assert.equal(exactItem.draftPurchaseQuantity, "4");
        assert.equal(exactItem.confirmedPurchaseQuantity, "100");
        assert.equal(JSON.stringify(body).match(/price|supplier|cost|shortage|recommend|project|forecast|available/i), null);
        const candidateIds = new Set(body.items.map((item) => item.product.id));
        for (const product of [exact, below, zero]) assert.equal(candidateIds.has(product.id), true);
        for (const product of [above, positiveAtZero, unset, noInventory, inactive, deleted]) assert.equal(candidateIds.has(product.id), false);

        const firstPage = await get("/inventory/replenishment-candidates?limit=1", allToken);
        const firstBody = await firstPage.json();
        assert.equal(typeof firstBody.nextCursor, "string");
        const secondPage = await get(`/inventory/replenishment-candidates?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`, allToken);
        const secondBody = await secondPage.json();
        assert.equal(secondPage.status, 200);
        assert.notEqual(firstBody.items[0].product.id, secondBody.items[0].product.id);
        assert.equal((await get(`/inventory/replenishment-candidates?limit=1&productCode=${encodeURIComponent(exact.code)}&cursor=${encodeURIComponent(firstBody.nextCursor)}`, allToken)).status, 400);

        const filtered = await get(`/inventory/replenishment-candidates?productCode=${encodeURIComponent(exact.code)}`, allToken);
        assert.equal(filtered.status, 200);
        assert.equal((await filtered.json()).items.length, 1);

        await prisma.$executeRawUnsafe('ANALYZE "Product"');
        await prisma.$executeRawUnsafe('ANALYZE "Inventory"');
        await prisma.$executeRawUnsafe('ANALYZE "ReplenishmentPolicy"');
        const planRows = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT i."productId" FROM "Inventory" i INNER JOIN "Product" p ON p."id" = i."productId" INNER JOIN "ReplenishmentPolicy" rp ON rp."productId" = i."productId" WHERE p."code" = '${exact.code}' AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL AND i."quantity" <= rp."reorderPointQuantity" ORDER BY p."code", i."productId" LIMIT 51`);
        });
        assert.match(JSON.stringify(planRows), /Product_code_key|ReplenishmentPolicy_productId_key/);
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
