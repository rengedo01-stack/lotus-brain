const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.REPLENISHMENT_POLICY_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c3_replenishment_policy_test";

if (databaseUrl === undefined) {
  test("replenishment-policy real database proof is opt-in", { skip: "REPLENISHMENT_POLICY_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("replenishment-policy real database proof requires its dedicated disposable database", () => {
      assert.fail(`REPLENISHMENT_POLICY_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const { DocumentBuilder, SwaggerModule } = require("@nestjs/swagger");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("replenishment policy keeps inventory-unit thresholds, permissions, and optimistic updates exact", async () => {
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
      const fixture = `c3-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
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
        return { token, csrf };
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
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "PR-006C3 each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-ACTIVE`, name: "PR-006C3 active", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const concurrentProduct = await prisma.product.create({ data: { code: `${fixture}-CONCURRENT`, name: "PR-006C3 concurrent", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const inactiveProduct = await prisma.product.create({ data: { code: `${fixture}-INACTIVE`, name: "PR-006C3 inactive", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "INACTIVE" } });
        const deletedProduct = await prisma.product.create({ data: { code: `${fixture}-DELETED`, name: "PR-006C3 deleted", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "INACTIVE", deletedAt: new Date("2026-09-09T00:00:00.000Z") } });

        const [admin, reader, writer, denied] = await Promise.all([
          prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006C3 admin", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-reader@example.test`, displayName: "PR-006C3 reader", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-writer@example.test`, displayName: "PR-006C3 writer", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "PR-006C3 denied", passwordHash: "not-used" } }),
        ]);
        const [readerRole, writerRole, deniedRole] = await Promise.all([
          prisma.role.create({ data: { code: `${fixture}-MASTER-READ`, name: "PR-006C3 master read" } }),
          prisma.role.create({ data: { code: `${fixture}-MASTER-WRITE`, name: "PR-006C3 master write" } }),
          prisma.role.create({ data: { code: `${fixture}-DENIED`, name: "PR-006C3 denied" } }),
        ]);
        const [masterRead, masterWrite] = await Promise.all([
          prisma.permission.findUniqueOrThrow({ where: { code: "master.read" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "master.write" } }),
        ]);
        await prisma.rolePermission.createMany({ data: [
          { roleId: readerRole.id, permissionId: masterRead.id },
          { roleId: writerRole.id, permissionId: masterWrite.id },
        ] });
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: "rbac-role-system-admin" },
          { userId: reader.id, roleId: readerRole.id },
          { userId: writer.id, roleId: writerRole.id },
          { userId: denied.id, roleId: deniedRole.id },
        ] });
        const [adminSession, readerSession, writerSession, deniedSession] = await Promise.all([
          createSession(admin.id, "admin"), createSession(reader.id, "reader"), createSession(writer.id, "writer"), createSession(denied.id, "denied"),
        ]);
        const baseUrl = await startApp();
        const swaggerDocument = SwaggerModule.createDocument(
          app,
          new DocumentBuilder().setTitle("PR-006C3 contract proof").build(),
        );
        const swaggerPath = swaggerDocument.paths["/api/v1/products/{productId}/replenishment-policy"];
        assert.ok(swaggerPath);
        assert.equal(swaggerPath.get.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(swaggerPath.post.responses["201"].content["application/json"].schema.additionalProperties, false);
        assert.equal(swaggerPath.patch.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(swaggerPath.post.requestBody.content["application/json"].schema.additionalProperties, false);
        assert.equal(swaggerPath.patch.requestBody.content["application/json"].schema.additionalProperties, false);
        let requestNumber = 0;
        const request = async (method, path, session, body) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, {
            method,
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": `127.0.0.${requestNumber}`,
              ...(session === undefined ? {} : { cookie: `lotus_session=${session.token}` }),
              ...(method === "GET" || session === undefined ? {} : { "x-csrf-token": session.csrf }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        };
        const path = (productId) => `/products/${encodeURIComponent(productId)}/replenishment-policy`;

        assert.equal((await request("GET", path(product.id))).status, 401);
        assert.equal((await request("GET", path(product.id), deniedSession)).status, 403);
        assert.equal((await request("POST", path(product.id), readerSession, { reorderPointQuantity: "1" })).status, 403);
        assert.equal((await request("GET", path(product.id), writerSession)).status, 403);

        const unset = await request("GET", path(product.id), readerSession);
        assert.equal(unset.status, 200);
        assert.equal(unset.headers.get("cache-control"), "private, no-store");
        const unsetBody = await unset.json();
        assert.deepEqual(Object.keys(unsetBody).sort(), ["policy", "product"]);
        assert.equal(unsetBody.policy, null);
        assert.deepEqual(Object.keys(unsetBody.product).sort(), ["code", "id", "inventoryUnit", "isDeleted", "name", "status"]);
        assert.deepEqual(Object.keys(unsetBody.product.inventoryUnit).sort(), ["code", "name", "symbol"]);
        assert.equal(JSON.stringify(unsetBody).match(/supplier|price|cost|draftPurchase|confirmedPurchase|recommend|shortage/i), null);

        assert.equal((await request("POST", path(product.id), adminSession, { reorderPointQuantity: "-1" })).status, 400);
        assert.equal((await request("POST", path(product.id), adminSession, { reorderPointQuantity: "01" })).status, 400);
        assert.equal((await request("POST", path(product.id), adminSession, { reorderPointQuantity: "1e3" })).status, 400);
        const created = await request("POST", path(product.id), adminSession, { reorderPointQuantity: "0" });
        assert.equal(created.status, 201);
        const createdBody = await created.json();
        assert.deepEqual(Object.keys(createdBody).sort(), ["createdAt", "id", "productId", "reorderPointQuantity", "updatedAt", "version"]);
        assert.equal(createdBody.productId, product.id);
        assert.equal(createdBody.reorderPointQuantity, "0");
        assert.equal(createdBody.version, 1);
        assert.equal((await request("POST", path(product.id), adminSession, { reorderPointQuantity: "1" })).status, 409);

        const updated = await request("PATCH", path(product.id), adminSession, { reorderPointQuantity: "999999999999999.123456789", expectedVersion: 1 });
        assert.equal(updated.status, 200);
        const updatedBody = await updated.json();
        assert.equal(updatedBody.reorderPointQuantity, "999999999999999.123456789");
        assert.equal(updatedBody.version, 2);
        assert.equal((await request("PATCH", path(product.id), adminSession, { reorderPointQuantity: "3", expectedVersion: 1 })).status, 409);
        assert.equal((await request("PATCH", path(product.id), adminSession, { reorderPointQuantity: "3", expectedVersion: 0 })).status, 400);

        assert.equal((await request("POST", path(inactiveProduct.id), adminSession, { reorderPointQuantity: "1" })).status, 409);
        assert.equal((await request("POST", path(deletedProduct.id), adminSession, { reorderPointQuantity: "1" })).status, 409);
        assert.equal((await request("POST", path("not-a-product"), adminSession, { reorderPointQuantity: "1" })).status, 404);

        const [createA, createB] = await Promise.all([
          request("POST", path(concurrentProduct.id), adminSession, { reorderPointQuantity: "1" }),
          request("POST", path(concurrentProduct.id), adminSession, { reorderPointQuantity: "2" }),
        ]);
        assert.deepEqual([createA.status, createB.status].sort(), [201, 409]);
        const concurrentPolicy = await prisma.replenishmentPolicy.findUniqueOrThrow({ where: { productId: concurrentProduct.id } });
        const [updateA, updateB] = await Promise.all([
          request("PATCH", path(concurrentProduct.id), adminSession, { reorderPointQuantity: "3", expectedVersion: concurrentPolicy.version }),
          request("PATCH", path(concurrentProduct.id), adminSession, { reorderPointQuantity: "4", expectedVersion: concurrentPolicy.version }),
        ]);
        assert.deepEqual([updateA.status, updateB.status].sort(), [200, 409]);
        assert.equal((await prisma.replenishmentPolicy.findUniqueOrThrow({ where: { productId: concurrentProduct.id } })).version, 2);

        const lifecycleRaceProduct = await prisma.product.create({
          data: {
            code: `${fixture}-LIFECYCLE-RACE`,
            name: "PR-006C3 lifecycle race",
            baseUnitId: unit.id,
            inventoryUnitId: unit.id,
          },
        });
        const lifecycleClient = new Client({ connectionString: databaseUrl });
        let lifecycleTransactionOpen = false;
        try {
          await lifecycleClient.connect();
          await lifecycleClient.query("BEGIN");
          lifecycleTransactionOpen = true;
          await lifecycleClient.query('SELECT "id" FROM "Product" WHERE "id" = $1 FOR UPDATE', [lifecycleRaceProduct.id]);
          const waitingCreate = request("POST", path(lifecycleRaceProduct.id), adminSession, { reorderPointQuantity: "1" });
          await new Promise((resolve) => setTimeout(resolve, 50));
          await lifecycleClient.query('UPDATE "Product" SET "status" = \'INACTIVE\' WHERE "id" = $1', [lifecycleRaceProduct.id]);
          await lifecycleClient.query("COMMIT");
          lifecycleTransactionOpen = false;
          assert.equal((await waitingCreate).status, 409);
          assert.equal(await prisma.replenishmentPolicy.findUnique({ where: { productId: lifecycleRaceProduct.id } }), null);
        } finally {
          if (lifecycleTransactionOpen) await lifecycleClient.query("ROLLBACK");
          await lifecycleClient.end();
        }

        await assert.rejects(
          () => prisma.$executeRawUnsafe(`INSERT INTO "ReplenishmentPolicy" ("id", "productId", "reorderPointQuantity", "version", "createdAt", "updatedAt") VALUES ('${fixture}-negative', '${inactiveProduct.id}', -1, 1, NOW(), NOW())`),
          /nonnegative/i,
        );
        await prisma.$executeRawUnsafe('ANALYZE "ReplenishmentPolicy"');
        const plan = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
          return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT * FROM "ReplenishmentPolicy" WHERE "productId" = '${product.id}'`);
        });
        assert.match(JSON.stringify(plan), /ReplenishmentPolicy_productId_key/);
      } finally {
        await app?.close();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanupClient = new Client({ connectionString: cleanupUrl.toString() });
        await cleanupClient.connect();
        try { await cleanupClient.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanupClient.end(); }
      }
    });
  }
}
