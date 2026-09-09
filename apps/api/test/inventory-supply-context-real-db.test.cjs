const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.INVENTORY_SUPPLY_CONTEXT_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c2_supply_context_test";

if (databaseUrl === undefined) {
  test("inventory supply-context real database proof is opt-in", { skip: "INVENTORY_SUPPLY_CONTEXT_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("inventory supply-context real database proof requires its dedicated disposable database", () => {
      assert.fail(`INVENTORY_SUPPLY_CONTEXT_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("inventory supply context requires both read permissions and returns only independent recorded facts without N+1 aggregation", async () => {
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
      const fixture = `pr006c2-${randomUUID()}`;
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
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-EA`, name: "PR-006C2 each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: { code: `${fixture}-A`, name: "PR-006C2 recorded product", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        const secondProduct = await prisma.product.create({
          data: { code: `${fixture}-B`, name: "PR-006C2 next product", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        const noInventoryProduct = await prisma.product.create({
          data: { code: `${fixture}-NO-INVENTORY`, name: "PR-006C2 no inventory", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        await prisma.inventory.createMany({
          data: [
            { productId: product.id, quantity: "12.500000000" },
            { productId: secondProduct.id, quantity: "0" },
          ],
        });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "PR-006C2 supplier" } });

        const createPurchase = async (suffix, productId, quantity, status) => {
          const purchase = await prisma.purchase.create({
            data: {
              id: `${fixture}-${suffix}`,
              supplierId: supplier.id,
              purchaseDate: new Date("2026-09-09T00:00:00.000Z"),
              documentNumber: `${fixture}-${suffix}`,
              items: {
                create: {
                  productId,
                  unitId: unit.id,
                  lineNumber: 1,
                  quantity,
                  unitPrice: "1.000000",
                  lineAmount: quantity,
                  taxRate: "0",
                },
              },
            },
          });
          if (status === "CONFIRMED") {
            await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "CONFIRMED" } });
          } else if (status === "POSTED") {
            await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "POSTED", postedAt: new Date("2026-09-09T01:00:00.000Z") } });
          } else if (status === "CANCELLED") {
            await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "CANCELLED", cancelledAt: new Date("2026-09-09T01:00:00.000Z") } });
          }
        };
        await createPurchase("DRAFT-1", product.id, "1.250000000", "DRAFT");
        await createPurchase("DRAFT-2", product.id, "2.750000000", "DRAFT");
        await createPurchase("CONFIRMED", product.id, "3.500000000", "CONFIRMED");
        await createPurchase("POSTED", product.id, "9.000000000", "POSTED");
        await createPurchase("CANCELLED", product.id, "11.000000000", "CANCELLED");
        await createPurchase("NO-INVENTORY", noInventoryProduct.id, "13.000000000", "DRAFT");

        await prisma.purchase.createMany({
          data: Array.from({ length: 2_000 }, (_, index) => ({
            id: `${fixture}-INDEX-${String(index).padStart(4, "0")}`,
            supplierId: supplier.id,
            purchaseDate: new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60)),
            documentNumber: `${fixture}-INDEX-${String(index).padStart(4, "0")}`,
          })),
        });
        await prisma.purchaseItem.createMany({
          data: Array.from({ length: 2_000 }, (_, index) => ({
            purchaseId: `${fixture}-INDEX-${String(index).padStart(4, "0")}`,
            productId: product.id,
            unitId: unit.id,
            lineNumber: 1,
            quantity: "1.000000000",
            unitPrice: "1.000000",
            lineAmount: "1.000000",
            taxRate: "0",
          })),
        });

        const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006C2 admin", passwordHash: "not-used" } });
        const inventoryOnly = await prisma.user.create({ data: { email: `${fixture}-inventory@example.test`, displayName: "PR-006C2 inventory", passwordHash: "not-used" } });
        const purchaseOnly = await prisma.user.create({ data: { email: `${fixture}-purchase@example.test`, displayName: "PR-006C2 purchase", passwordHash: "not-used" } });
        const inventoryRole = await prisma.role.create({ data: { code: `${fixture}-INVENTORY`, name: "PR-006C2 inventory only" } });
        const purchaseRole = await prisma.role.create({ data: { code: `${fixture}-PURCHASE`, name: "PR-006C2 purchase only" } });
        const [inventoryPermission, purchasePermission] = await Promise.all([
          prisma.permission.findUniqueOrThrow({ where: { code: "inventory.read" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "purchase.read" } }),
        ]);
        await prisma.rolePermission.createMany({
          data: [
            { roleId: inventoryRole.id, permissionId: inventoryPermission.id },
            { roleId: purchaseRole.id, permissionId: purchasePermission.id },
          ],
        });
        await prisma.userRole.createMany({
          data: [
            { userId: admin.id, roleId: "rbac-role-system-admin" },
            { userId: inventoryOnly.id, roleId: inventoryRole.id },
            { userId: purchaseOnly.id, roleId: purchaseRole.id },
          ],
        });
        const [adminToken, inventoryToken, purchaseToken] = await Promise.all([
          createSession(admin.id, "admin"),
          createSession(inventoryOnly.id, "inventory"),
          createSession(purchaseOnly.id, "purchase"),
        ]);
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

        assert.equal((await get("/inventory/supply-context")).status, 401);
        assert.equal((await get("/inventory/supply-context", inventoryToken)).status, 403);
        assert.equal((await get("/inventory/supply-context", purchaseToken)).status, 403);

        const firstResponse = await get(`/inventory/supply-context?limit=1&productCode=${encodeURIComponent(product.code)}`, adminToken);
        assert.equal(firstResponse.status, 200);
        assert.equal(firstResponse.headers.get("cache-control"), "private, no-store");
        const first = await firstResponse.json();
        assert.deepEqual(Object.keys(first).sort(), ["items", "nextCursor"]);
        assert.equal(first.items.length, 1);
        assert.deepEqual(Object.keys(first.items[0]).sort(), ["confirmedPurchaseQuantity", "currentQuantity", "draftPurchaseQuantity", "inventoryUnit", "product"]);
        assert.deepEqual(Object.keys(first.items[0].product).sort(), ["code", "id", "name"]);
        assert.equal(first.items[0].product.id, product.id);
        assert.equal(first.items[0].currentQuantity, "12.5");
        assert.equal(first.items[0].draftPurchaseQuantity, "2004");
        assert.equal(first.items[0].confirmedPurchaseQuantity, "3.5");
        assert.equal(JSON.stringify(first).match(/price|supplier|cost|available|expected|recommend|shortage/i), null);
        assert.equal(first.nextCursor, null);

        const unfiltered = await get("/inventory/supply-context?limit=1", adminToken);
        assert.equal(unfiltered.status, 200);
        const unfilteredBody = await unfiltered.json();
        assert.equal(typeof unfilteredBody.nextCursor, "string");
        assert.equal((await get(`/inventory/supply-context?limit=1&productCode=${encodeURIComponent(secondProduct.code)}&cursor=${encodeURIComponent(unfilteredBody.nextCursor)}`, adminToken)).status, 400);
        const allRecorded = await get("/inventory/supply-context?limit=50", adminToken);
        assert.equal(allRecorded.status, 200);
        assert.equal((await allRecorded.json()).items.some((item) => item.product.id === noInventoryProduct.id), false);

        await prisma.$executeRawUnsafe('ANALYZE "PurchaseItem"');
        const planRows = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT pi."productId", SUM(pi."quantity") FROM "PurchaseItem" AS pi INNER JOIN "Purchase" AS p ON p."id" = pi."purchaseId" WHERE pi."productId" = '${product.id}' AND p."status" = 'DRAFT' GROUP BY pi."productId"`);
        });
        assert.match(JSON.stringify(planRows), /PurchaseItem_purchaseId_productId_idx/);
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
