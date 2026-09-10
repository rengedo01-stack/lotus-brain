const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PRODUCT_SUPPLIER_PACKAGE_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c10_supplier_packages_test";

if (databaseUrl === undefined) {
  test("supplier package real database proof is opt-in", { skip: "PRODUCT_SUPPLIER_PACKAGE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("supplier package real database proof requires its dedicated disposable database", () => {
      assert.fail(`PRODUCT_SUPPLIER_PACKAGE_DATABASE_URL must target ${allowedDatabaseName}.`);
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

    test("supplier packages remain relationship-scoped, versioned, and Purchase/Price independent", async () => {
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
      const fixture = `c10-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      let app;

      const createSession = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({ data: {
          userId, tokenHash: hash(token), csrfTokenHash: hash(csrf), credentialVersion: user.credentialVersion,
          authenticationPolicyVersion: user.authenticationPolicyVersion, expiresAt: new Date(Date.now() + 300_000), activatedAt: new Date(),
        } });
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
        return `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
      };

      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-KG`, name: "Kilogram", symbol: "kg", dimension: "MASS" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER`, name: "Supplier" } });
        const supplierTwo = await prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER-2`, name: "Supplier 2" } });
        const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id } });
        const concurrentRelationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplierTwo.id } });
        const price = await prisma.priceMaster.create({ data: { productId: product.id, supplierId: supplier.id, currentUnitPrice: "10.000000" } });
        const purchaseBefore = await prisma.purchase.create({ data: {
          supplierId: supplier.id, purchaseDate: new Date("2026-09-11T00:00:00.000Z"), documentNumber: `${fixture}-before`,
          items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "1.000000000", unitPrice: "10.000000", lineAmount: "10.000000", taxRate: "0" } },
        } });

        const [admin, reader, writer, denied] = await Promise.all([
          prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "admin", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-reader@example.test`, displayName: "reader", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-writer@example.test`, displayName: "writer", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "denied", passwordHash: "not-used" } }),
        ]);
        const [readRole, writeRole, deniedRole] = await Promise.all([
          prisma.role.create({ data: { code: `${fixture}-READ`, name: "read" } }),
          prisma.role.create({ data: { code: `${fixture}-WRITE`, name: "write" } }),
          prisma.role.create({ data: { code: `${fixture}-DENIED`, name: "denied" } }),
        ]);
        const [masterRead, masterWrite] = await Promise.all([
          prisma.permission.findUniqueOrThrow({ where: { code: "master.read" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "master.write" } }),
        ]);
        await prisma.rolePermission.createMany({ data: [{ roleId: readRole.id, permissionId: masterRead.id }, { roleId: writeRole.id, permissionId: masterWrite.id }] });
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: "rbac-role-system-admin" }, { userId: reader.id, roleId: readRole.id },
          { userId: writer.id, roleId: writeRole.id }, { userId: denied.id, roleId: deniedRole.id },
        ] });
        const [adminSession, readerSession, writerSession, deniedSession] = await Promise.all([
          createSession(admin.id, "admin"), createSession(reader.id, "reader"), createSession(writer.id, "writer"), createSession(denied.id, "denied"),
        ]);
        const baseUrl = await startApp();
        const swagger = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("C10").build());
        const collectionSwagger = swagger.paths["/api/v1/product-supply-relationships/{relationshipId}/packages"];
        const detailSwagger = swagger.paths["/api/v1/product-supply-relationships/{relationshipId}/packages/{packageId}"];
        assert.ok(collectionSwagger); assert.ok(detailSwagger);
        assert.equal(collectionSwagger.get.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(collectionSwagger.post.responses["201"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.get.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.patch.responses["200"].content["application/json"].schema.additionalProperties, false);

        let requestNumber = 0;
        const request = async (method, path, session, body) => fetch(`${baseUrl}${path}`, {
          method, headers: { "content-type": "application/json", "x-forwarded-for": `127.0.0.${++requestNumber}`,
            ...(session === undefined ? {} : { cookie: `lotus_session=${session.token}` }),
            ...(method === "GET" || session === undefined ? {} : { "x-csrf-token": session.csrf }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const path = (relationshipId, packageId) => `/product-supply-relationships/${encodeURIComponent(relationshipId)}/packages${packageId === undefined ? "" : `/${encodeURIComponent(packageId)}`}`;
        const create = (relationshipId, body, session = adminSession) => request("POST", path(relationshipId), session, body);
        const update = (relationshipId, packageId, body, session = adminSession) => request("PATCH", path(relationshipId, packageId), session, body);
        const valid = { code: "CASE", name: "10 kg case", inventoryQuantityPerPackage: "10", isOrderable: true, status: "ACTIVE" };

        assert.equal((await request("GET", path(relationship.id))).status, 401);
        assert.equal((await request("GET", path(relationship.id), deniedSession)).status, 403);
        assert.equal((await create(relationship.id, valid, readerSession)).status, 403);
        const empty = await request("GET", path(relationship.id), readerSession);
        assert.equal(empty.status, 200); assert.equal(empty.headers.get("cache-control"), "private, no-store");
        assert.deepEqual((await empty.json()).packages, []);
        assert.equal((await create(relationship.id, { ...valid, inventoryQuantityPerPackage: "0" })).status, 400);
        assert.equal((await create(relationship.id, { ...valid, extra: true })).status, 400);
        const created = await create(relationship.id, valid);
        assert.equal(created.status, 201);
        const createdBody = await created.json();
        assert.deepEqual(Object.keys(createdBody).sort(), ["package", "relationship"]);
        assert.equal(createdBody.package.inventoryQuantityPerPackage, "10.000000000");
        assert.equal(createdBody.package.isOrderable, true);
        assert.equal(createdBody.package.version, 1);
        const packageId = createdBody.package.id;
        assert.equal((await create(relationship.id, valid)).status, 409);
        const updated = await update(relationship.id, packageId, { ...valid, name: "5 kg case", inventoryQuantityPerPackage: "5", isOrderable: false, status: "DISABLED", expectedVersion: 1 });
        assert.equal(updated.status, 200); assert.equal((await updated.json()).package.version, 2);
        assert.equal((await update(relationship.id, packageId, { ...valid, expectedVersion: 1 })).status, 409);

        const relationshipCurrent = await prisma.productSupplyRelationship.findUniqueOrThrow({ where: { id: relationship.id } });
        const relationshipUpdate = request("PATCH", `/product-supply-relationships/${relationship.id}`, adminSession, { status: "DISABLED", expectedVersion: relationshipCurrent.version });
        const packageRaceUpdate = update(relationship.id, packageId, { ...valid, status: "ACTIVE", expectedVersion: 2 });
        const [relationshipRaceResponse, packageRaceResponse] = await Promise.all([relationshipUpdate, packageRaceUpdate]);
        assert.deepEqual([relationshipRaceResponse.status, packageRaceResponse.status].sort(), [200, 200]);
        const disabledRelationshipUpdate = await update(relationship.id, packageId, { ...valid, status: "DISABLED", expectedVersion: 3 });
        assert.equal(disabledRelationshipUpdate.status, 200);

        await prisma.product.update({
          where: { id: product.id },
          data: { status: "INACTIVE", deletedAt: new Date() },
        });
        const inactiveParentUpdate = await update(relationship.id, packageId, {
          ...valid,
          name: "Case 30",
          inventoryQuantityPerPackage: "30",
          isOrderable: false,
          status: "DISABLED",
          expectedVersion: 4,
        });
        assert.equal(inactiveParentUpdate.status, 200);

        const [createA, createB] = await Promise.all([
          create(concurrentRelationship.id, valid), create(concurrentRelationship.id, valid),
        ]);
        assert.deepEqual([createA.status, createB.status].sort(), [201, 409]);
        const concurrentPackage = await prisma.productSupplierPackage.findUniqueOrThrow({ where: { relationshipId_code: { relationshipId: concurrentRelationship.id, code: "CASE" } } });
        const [updateA, updateB] = await Promise.all([
          update(concurrentRelationship.id, concurrentPackage.id, { ...valid, name: "A", expectedVersion: concurrentPackage.version }),
          update(concurrentRelationship.id, concurrentPackage.id, { ...valid, name: "B", expectedVersion: concurrentPackage.version }),
        ]);
        assert.deepEqual([updateA.status, updateB.status].sort(), [200, 409]);

        const purchaseAfter = await prisma.purchase.create({ data: {
          supplierId: supplier.id, purchaseDate: new Date("2026-09-11T01:00:00.000Z"), documentNumber: `${fixture}-after`,
          items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "2.000000000", unitPrice: "10.000000", lineAmount: "20.000000", taxRate: "0" } },
        } });
        assert.equal(purchaseBefore.status, "DRAFT"); assert.equal(purchaseAfter.status, "DRAFT");
        assert.deepEqual(await prisma.priceMaster.findUniqueOrThrow({ where: { id: price.id } }), price);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierPackage" ("id", "relationshipId", "code", "name", "inventoryQuantityPerPackage", "isOrderable", "status", "version", "createdAt", "updatedAt") VALUES ('${fixture}-zero', '${concurrentRelationship.id}', 'ZERO', 'Zero', 0, false, 'ACTIVE', 1, NOW(), NOW())`), /inventory_quantity_positive/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM "ProductSupplyRelationship" WHERE "id" = '${relationship.id}'`), /foreign key/i);
      } finally {
        await app?.close(); await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() }); await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE)`); } finally { await cleanup.end(); }
      }
    });
  }
}
