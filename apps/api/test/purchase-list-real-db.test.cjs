const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PURCHASE_LIST_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006b1_purchase_list_test";

if (databaseUrl === undefined) {
  test("purchase list real database proof is opt-in", { skip: "PURCHASE_LIST_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("purchase list real database proof requires its dedicated disposable database", () => {
      assert.fail(`PURCHASE_LIST_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("purchase list HTTP proof preserves read permission, exact projection, filter-bound keysets, historical suppliers, and index usability", async () => {
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
      const fixture = `pr006b1-${randomUUID()}`;
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
        const historicalSupplier = await prisma.supplier.create({
          data: { code: `${fixture}-SUP-HIST`, name: "PR-006B1 historical supplier", status: "ACTIVE" },
        });
        const indexedSupplier = await prisma.supplier.create({
          data: { code: `${fixture}-SUP-IDX`, name: "PR-006B1 indexed supplier", status: "ACTIVE" },
        });
        const sharedDate = new Date("2026-09-08T00:00:00.000Z");
        const olderDate = new Date("2026-09-07T00:00:00.000Z");
        const purchases = await prisma.purchase.createMany({
          data: [
            { id: `${fixture}-purchase-003`, supplierId: historicalSupplier.id, purchaseDate: sharedDate, documentNumber: `${fixture}-PO-003` },
            { id: `${fixture}-purchase-002`, supplierId: historicalSupplier.id, purchaseDate: sharedDate, documentNumber: `${fixture}-PO-002` },
            { id: `${fixture}-purchase-001`, supplierId: historicalSupplier.id, purchaseDate: sharedDate, documentNumber: `${fixture}-PO-001` },
            { id: `${fixture}-purchase-older`, supplierId: historicalSupplier.id, purchaseDate: olderDate, documentNumber: `${fixture}-PO-OLDER` },
          ],
        });
        assert.equal(purchases.count, 4);
        await prisma.purchase.update({
          where: { id: `${fixture}-purchase-002` },
          data: { status: "CONFIRMED" },
        });
        await prisma.supplier.update({
          where: { id: historicalSupplier.id },
          data: { status: "INACTIVE", deletedAt: new Date("2026-09-09T00:00:00.000Z") },
        });

        await prisma.purchase.createMany({
          data: Array.from({ length: 5000 }, (_, index) => ({
            id: `${fixture}-index-${String(index).padStart(4, "0")}`,
            supplierId: indexedSupplier.id,
            purchaseDate: new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60, index % 1000)),
            documentNumber: `${fixture}-IDX-${String(index).padStart(4, "0")}`,
          })),
        });

        const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006B1 admin", passwordHash: "not-used" } });
        const denied = await prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "PR-006B1 denied", passwordHash: "not-used" } });
        const noReadRole = await prisma.role.create({
          data: { code: `${fixture}-NO-PURCHASE-READ`, name: "PR-006B1 no purchase read" },
        });
        await prisma.userRole.createMany({
          data: [
            { userId: admin.id, roleId: "rbac-role-system-admin" },
            { userId: denied.id, roleId: noReadRole.id },
          ],
        });
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "purchase.read" } });
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
            headers: {
              "x-forwarded-for": `127.0.0.${requestNumber}`,
              ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }),
            },
          });
        };

        assert.equal((await get("/purchases")).status, 401);
        assert.equal((await get("/purchases", deniedToken)).status, 403);

        const firstResponse = await get(`/purchases?limit=2&supplierCode=${encodeURIComponent(historicalSupplier.code)}`, adminToken);
        assert.equal(firstResponse.status, 200);
        const first = await firstResponse.json();
        assert.deepEqual(Object.keys(first).sort(), ["items", "nextCursor"]);
        assert.deepEqual(first.items.map((item) => item.id), [`${fixture}-purchase-003`, `${fixture}-purchase-002`]);
        assert.equal(typeof first.nextCursor, "string");
        assert.ok(first.items.every((item) => Object.keys(item).sort().join(",") === "cancelledAt,documentNumber,id,postedAt,purchaseDate,status,supplier"));
        assert.ok(first.items.every((item) => Object.keys(item.supplier).sort().join(",") === "code,name"));
        assert.ok(first.items.every((item) => item.supplier.code === historicalSupplier.code));
        assert.ok(first.items.every((item) => !JSON.stringify(item).match(/subtotal|tax|total|currency|unitPrice|items|note|cost|source|audit/i)));

        const nextResponse = await get(`/purchases?limit=2&supplierCode=${encodeURIComponent(historicalSupplier.code)}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken);
        assert.equal(nextResponse.status, 200);
        const next = await nextResponse.json();
        assert.deepEqual(next.items.map((item) => item.id), [`${fixture}-purchase-001`, `${fixture}-purchase-older`]);
        assert.equal(next.nextCursor, null);

        const confirmedResponse = await get(`/purchases?status=CONFIRMED&supplierCode=${encodeURIComponent(historicalSupplier.code)}`, adminToken);
        assert.equal(confirmedResponse.status, 200);
        assert.deepEqual((await confirmedResponse.json()).items.map((item) => item.id), [`${fixture}-purchase-002`]);
        const documentResponse = await get(`/purchases?documentNumber=${encodeURIComponent(`${fixture}-PO-003`)}`, adminToken);
        assert.equal(documentResponse.status, 200);
        assert.deepEqual((await documentResponse.json()).items.map((item) => item.id), [`${fixture}-purchase-003`]);
        const dateResponse = await get(`/purchases?from=2026-09-08T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&supplierCode=${encodeURIComponent(historicalSupplier.code)}`, adminToken);
        assert.equal(dateResponse.status, 200);
        assert.deepEqual((await dateResponse.json()).items.map((item) => item.id), [`${fixture}-purchase-003`, `${fixture}-purchase-002`, `${fixture}-purchase-001`]);

        assert.equal((await get(`/purchases?limit=2&status=DRAFT&supplierCode=${encodeURIComponent(historicalSupplier.code)}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken)).status, 400);
        assert.equal((await get("/purchases?cursor=not-a-cursor", adminToken)).status, 400);
        assert.equal((await get("/purchases?from=2026-09-08", adminToken)).status, 400);
        assert.equal((await get("/purchases?from=2026-09-09T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z", adminToken)).status, 400);

        await prisma.$executeRawUnsafe('ANALYZE "Purchase"');
        const byDatePlan = await prisma.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT "id" FROM "Purchase" ORDER BY "purchaseDate" DESC, "id" DESC LIMIT 50');
        assert.match(JSON.stringify(byDatePlan), /Purchase_purchaseDate_id_desc_idx/);
        const documentNumber = `${fixture}-IDX-0500`;
        const byDocumentPlan = await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT "id" FROM "Purchase" WHERE "documentNumber" = '${documentNumber}' ORDER BY "purchaseDate" DESC, "id" DESC LIMIT 50`);
        assert.match(JSON.stringify(byDocumentPlan), /Purchase_documentNumber_purchaseDate_id_desc_idx/);
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
