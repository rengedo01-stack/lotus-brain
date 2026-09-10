const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PRODUCT_SUPPLY_RELATIONSHIP_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c8_product_supply_relationship_test";

if (databaseUrl === undefined) {
  test("product-supply-relationship real database proof is opt-in", { skip: "PRODUCT_SUPPLY_RELATIONSHIP_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("product-supply-relationship real database proof requires its dedicated disposable database", () => {
      assert.fail(`PRODUCT_SUPPLY_RELATIONSHIP_DATABASE_URL must target ${allowedDatabaseName}.`);
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

    test("Product-Supplier relationships keep a permanent pair identity and parent lifecycle integrity", async () => {
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
      const fixture = `c8-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
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
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-EA`, name: "PR-006C8 each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" },
        });
        const product = await prisma.product.create({
          data: { code: `${fixture}-PRODUCT`, name: "PR-006C8 product", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        const concurrentProduct = await prisma.product.create({
          data: { code: `${fixture}-CONCURRENT`, name: "PR-006C8 concurrent", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        const lifecycleRaceProduct = await prisma.product.create({
          data: { code: `${fixture}-CREATE-RACE`, name: "PR-006C8 create race", baseUnitId: unit.id, inventoryUnitId: unit.id },
        });
        const inactiveProduct = await prisma.product.create({
          data: { code: `${fixture}-INACTIVE`, name: "PR-006C8 inactive", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "INACTIVE" },
        });
        const deletedProduct = await prisma.product.create({
          data: { code: `${fixture}-DELETED`, name: "PR-006C8 deleted", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "INACTIVE", deletedAt: new Date("2026-09-10T00:00:00.000Z") },
        });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER`, name: "PR-006C8 supplier" } });
        const concurrentSupplier = await prisma.supplier.create({ data: { code: `${fixture}-CONCURRENT`, name: "PR-006C8 concurrent supplier" } });
        const lifecycleRaceSupplier = await prisma.supplier.create({ data: { code: `${fixture}-REENABLE-RACE`, name: "PR-006C8 reenable race supplier" } });
        const inactiveSupplier = await prisma.supplier.create({ data: { code: `${fixture}-INACTIVE`, name: "PR-006C8 inactive supplier", status: "INACTIVE" } });
        const deletedSupplier = await prisma.supplier.create({ data: { code: `${fixture}-DELETED`, name: "PR-006C8 deleted supplier", status: "INACTIVE", deletedAt: new Date("2026-09-10T00:00:00.000Z") } });
        await prisma.priceMaster.create({
          data: { productId: product.id, supplierId: supplier.id, currentUnitPrice: "10.000000" },
        });
        const initialPriceMaster = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: product.id, supplierId: supplier.id } } });

        const [admin, reader, writer, denied] = await Promise.all([
          prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006C8 admin", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-reader@example.test`, displayName: "PR-006C8 reader", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-writer@example.test`, displayName: "PR-006C8 writer", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "PR-006C8 denied", passwordHash: "not-used" } }),
        ]);
        const [readerRole, writerRole, deniedRole] = await Promise.all([
          prisma.role.create({ data: { code: `${fixture}-MASTER-READ`, name: "PR-006C8 master read" } }),
          prisma.role.create({ data: { code: `${fixture}-MASTER-WRITE`, name: "PR-006C8 master write" } }),
          prisma.role.create({ data: { code: `${fixture}-DENIED`, name: "PR-006C8 denied" } }),
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
          createSession(admin.id, "admin"),
          createSession(reader.id, "reader"),
          createSession(writer.id, "writer"),
          createSession(denied.id, "denied"),
        ]);
        const baseUrl = await startApp();
        const swaggerDocument = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("PR-006C8 contract proof").build());
        const collectionSwagger = swaggerDocument.paths["/api/v1/product-supply-relationships"];
        const detailSwagger = swaggerDocument.paths["/api/v1/product-supply-relationships/{id}"];
        assert.ok(collectionSwagger);
        assert.ok(detailSwagger);
        assert.equal(collectionSwagger.get.responses["200"].content["application/json"].schema.type, "array");
        assert.equal(collectionSwagger.get.responses["200"].content["application/json"].schema.items.additionalProperties, false);
        assert.equal(collectionSwagger.post.responses["201"].content["application/json"].schema.additionalProperties, false);
        assert.equal(collectionSwagger.post.requestBody.content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.patch.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.patch.requestBody.content["application/json"].schema.additionalProperties, false);
        assert.deepEqual(collectionSwagger.post.requestBody.content["application/json"].schema.required, ["productId", "supplierId"]);
        assert.deepEqual(detailSwagger.patch.requestBody.content["application/json"].schema.required, ["status", "expectedVersion"]);

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
        const collectionPath = "/product-supply-relationships";
        const detailPath = (id) => `${collectionPath}/${encodeURIComponent(id)}`;
        const create = (productId, supplierId, session = adminSession) => request("POST", collectionPath, session, { productId, supplierId });
        const update = (id, status, expectedVersion, session = adminSession) => request("PATCH", detailPath(id), session, { status, expectedVersion });

        assert.equal((await request("GET", collectionPath)).status, 401);
        assert.equal((await request("GET", collectionPath, deniedSession)).status, 403);
        assert.equal((await request("GET", collectionPath, writerSession)).status, 403);
        assert.equal((await create(product.id, supplier.id, readerSession)).status, 403);
        assert.equal((await create(product.id, supplier.id, adminSession)).status, 201);
        const relationshipResponse = await request("GET", collectionPath, readerSession);
        assert.equal(relationshipResponse.status, 200);
        assert.equal(relationshipResponse.headers.get("cache-control"), "private, no-store");
        const listed = await relationshipResponse.json();
        assert.equal(listed.length, 1);
        const relationship = listed[0];
        assert.deepEqual(Object.keys(relationship).sort(), ["createdAt", "id", "product", "productId", "status", "supplier", "supplierId", "updatedAt", "version"]);
        assert.deepEqual(Object.keys(relationship.product).sort(), ["code", "id", "isDeleted", "name", "status"]);
        assert.deepEqual(Object.keys(relationship.supplier).sort(), ["code", "id", "isDeleted", "name", "status"]);
        assert.equal(relationship.status, "ACTIVE");
        assert.equal(relationship.version, 1);
        assert.equal(JSON.stringify(relationship).match(/price|purchase|moq|lead|preferred|target|reorder/i), null);
        assert.equal((await create(product.id, supplier.id)).status, 409);
        assert.equal((await create(inactiveProduct.id, supplier.id)).status, 409);
        assert.equal((await create(deletedProduct.id, supplier.id)).status, 409);
        assert.equal((await create(product.id, inactiveSupplier.id)).status, 409);
        assert.equal((await create(product.id, deletedSupplier.id)).status, 409);
        assert.equal((await create("missing-product", supplier.id)).status, 404);
        assert.equal((await create(product.id, "missing-supplier")).status, 404);
        assert.equal((await request("POST", collectionPath, adminSession, { productId: product.id })).status, 400);

        // Existing Purchase rows and PriceMaster entries have no relationship
        // precondition. Both must remain independent of this C8 entity.
        const firstPurchase = await prisma.purchase.create({
          data: {
            supplierId: supplier.id,
            purchaseDate: new Date("2026-09-10T00:00:00.000Z"),
            documentNumber: `${fixture}-before-disable`,
            items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "1.000000000", unitPrice: "10.000000", lineAmount: "10.000000", taxRate: "0" } },
          },
        });
        assert.equal(firstPurchase.status, "DRAFT");
        assert.equal((await update(relationship.id, "DISABLED", 1)).status, 200);
        const disabled = await prisma.productSupplyRelationship.findUniqueOrThrow({ where: { id: relationship.id } });
        assert.equal(disabled.status, "DISABLED");
        assert.equal(disabled.version, 2);
        assert.equal((await create(product.id, supplier.id)).status, 409);
        const secondPurchase = await prisma.purchase.create({
          data: {
            supplierId: supplier.id,
            purchaseDate: new Date("2026-09-10T01:00:00.000Z"),
            documentNumber: `${fixture}-after-disable`,
            items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "2.000000000", unitPrice: "10.000000", lineAmount: "20.000000", taxRate: "0" } },
          },
        });
        assert.equal(secondPurchase.status, "DRAFT");
        assert.equal(await prisma.purchase.count({ where: { supplierId: supplier.id } }), 2);
        assert.deepEqual(
          await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: product.id, supplierId: supplier.id } } }),
          initialPriceMaster,
        );

        await prisma.product.update({ where: { id: product.id }, data: { status: "INACTIVE" } });
        assert.equal((await update(relationship.id, "ACTIVE", 2)).status, 409);
        await prisma.product.update({ where: { id: product.id }, data: { status: "ACTIVE" } });
        await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "INACTIVE" } });
        assert.equal((await update(relationship.id, "ACTIVE", 2)).status, 409);
        await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "ACTIVE" } });
        const reenabled = await update(relationship.id, "ACTIVE", 2);
        assert.equal(reenabled.status, 200);
        assert.equal((await reenabled.json()).version, 3);
        await prisma.product.update({ where: { id: product.id }, data: { status: "INACTIVE", deletedAt: new Date("2026-09-10T02:00:00.000Z") } });
        await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "INACTIVE", deletedAt: new Date("2026-09-10T02:00:00.000Z") } });
        const closedAfterParentClosure = await update(relationship.id, "DISABLED", 3);
        assert.equal(closedAfterParentClosure.status, 200);
        const closedBody = await closedAfterParentClosure.json();
        assert.equal(closedBody.status, "DISABLED");
        assert.equal(closedBody.product.isDeleted, true);
        assert.equal(closedBody.supplier.isDeleted, true);
        assert.equal((await update(relationship.id, "ACTIVE", 4)).status, 409);

        await prisma.product.update({ where: { id: product.id }, data: { status: "ACTIVE", deletedAt: null } });
        await prisma.supplier.update({ where: { id: supplier.id }, data: { status: "ACTIVE", deletedAt: null } });
        assert.equal((await update(relationship.id, "ACTIVE", 4)).status, 200);
        assert.equal((await update(relationship.id, "DISABLED", 4)).status, 409);

        const [createA, createB] = await Promise.all([
          create(concurrentProduct.id, concurrentSupplier.id),
          create(concurrentProduct.id, concurrentSupplier.id),
        ]);
        assert.deepEqual([createA.status, createB.status].sort(), [201, 409]);
        const concurrentRelationship = await prisma.productSupplyRelationship.findUniqueOrThrow({ where: { productId_supplierId: { productId: concurrentProduct.id, supplierId: concurrentSupplier.id } } });
        const [updateA, updateB] = await Promise.all([
          update(concurrentRelationship.id, "DISABLED", concurrentRelationship.version),
          update(concurrentRelationship.id, "DISABLED", concurrentRelationship.version),
        ]);
        assert.deepEqual([updateA.status, updateB.status].sort(), [200, 409]);
        assert.equal((await prisma.productSupplyRelationship.findUniqueOrThrow({ where: { id: concurrentRelationship.id } })).version, 2);

        const createRaceClient = new Client({ connectionString: databaseUrl });
        let createRaceTransactionOpen = false;
        try {
          await createRaceClient.connect();
          await createRaceClient.query("BEGIN");
          createRaceTransactionOpen = true;
          await createRaceClient.query('SELECT "id" FROM "Product" WHERE "id" = $1 FOR UPDATE', [lifecycleRaceProduct.id]);
          const waitingCreate = create(lifecycleRaceProduct.id, lifecycleRaceSupplier.id);
          await new Promise((resolve) => setTimeout(resolve, 50));
          await createRaceClient.query('UPDATE "Product" SET "status" = \'INACTIVE\' WHERE "id" = $1', [lifecycleRaceProduct.id]);
          await createRaceClient.query("COMMIT");
          createRaceTransactionOpen = false;
          assert.equal((await waitingCreate).status, 409);
          assert.equal(await prisma.productSupplyRelationship.findUnique({ where: { productId_supplierId: { productId: lifecycleRaceProduct.id, supplierId: lifecycleRaceSupplier.id } } }), null);
        } finally {
          if (createRaceTransactionOpen) await createRaceClient.query("ROLLBACK");
          await createRaceClient.end();
        }

        const raceRelationshipResponse = await create(concurrentProduct.id, lifecycleRaceSupplier.id);
        assert.equal(raceRelationshipResponse.status, 201);
        const raceRelationship = await raceRelationshipResponse.json();
        assert.equal((await update(raceRelationship.id, "DISABLED", 1)).status, 200);
        const reenableRaceClient = new Client({ connectionString: databaseUrl });
        let reenableRaceTransactionOpen = false;
        try {
          await reenableRaceClient.connect();
          await reenableRaceClient.query("BEGIN");
          reenableRaceTransactionOpen = true;
          await reenableRaceClient.query('SELECT "id" FROM "Supplier" WHERE "id" = $1 FOR UPDATE', [lifecycleRaceSupplier.id]);
          const waitingReenable = update(raceRelationship.id, "ACTIVE", 2);
          await new Promise((resolve) => setTimeout(resolve, 50));
          await reenableRaceClient.query('UPDATE "Supplier" SET "status" = \'INACTIVE\' WHERE "id" = $1', [lifecycleRaceSupplier.id]);
          await reenableRaceClient.query("COMMIT");
          reenableRaceTransactionOpen = false;
          assert.equal((await waitingReenable).status, 409);
          assert.equal((await prisma.productSupplyRelationship.findUniqueOrThrow({ where: { id: raceRelationship.id } })).status, "DISABLED");
        } finally {
          if (reenableRaceTransactionOpen) await reenableRaceClient.query("ROLLBACK");
          await reenableRaceClient.end();
        }

        await assert.rejects(
          () => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplyRelationship" ("id", "productId", "supplierId", "status", "version", "createdAt", "updatedAt") VALUES ('${fixture}-bad-version', '${inactiveProduct.id}', '${inactiveSupplier.id}', 'DISABLED', 0, NOW(), NOW())`),
          /version_positive/i,
        );
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
