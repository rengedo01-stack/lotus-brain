const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PRODUCT_SUPPLIER_COMMERCIAL_TERMS_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c19_commercial_terms_test";

if (databaseUrl === undefined) {
  test("product-supplier commercial terms real database proof is opt-in", { skip: "PRODUCT_SUPPLIER_COMMERCIAL_TERMS_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("product-supplier commercial terms real database proof requires its dedicated disposable database", () => {
      assert.fail(`PRODUCT_SUPPLIER_COMMERCIAL_TERMS_DATABASE_URL must target ${allowedDatabaseName}.`);
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

    test("supplier commercial terms are JPY tax-exclusive current master authority with safe lifecycle and no PriceMaster interference", async () => {
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
      const fixture = `c19-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
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
      const relationshipFor = async (productId, code) => {
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-${code}`, name: code } });
        return prisma.productSupplyRelationship.create({ data: { productId, supplierId: supplier.id } });
      };

      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-KG`, name: "Kilogram", symbol: "kg", dimension: "MASS" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER`, name: "Supplier" } });
        const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplier.id } });
        const concurrentRelationship = await relationshipFor(product.id, "CONCURRENT");
        const [currencyRelationship, priceRelationship, lowTaxRelationship, highTaxRelationship, versionRelationship] = await Promise.all([
          relationshipFor(product.id, "CURRENCY"), relationshipFor(product.id, "PRICE"), relationshipFor(product.id, "LOW-TAX"), relationshipFor(product.id, "HIGH-TAX"), relationshipFor(product.id, "VERSION"),
        ]);
        const priceMaster = await prisma.priceMaster.create({ data: { productId: product.id, supplierId: supplier.id, currentUnitPrice: "10.000000", currency: "JPY" } });

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
        assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { status: "ok" });
        const swagger = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("C19").build());
        const detailSwagger = swagger.paths["/api/v1/product-supply-relationships/{relationshipId}/commercial-terms"];
        assert.ok(detailSwagger);
        assert.equal(detailSwagger.get.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.post.responses["201"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.patch.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(detailSwagger.delete.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.ok(detailSwagger.post.responses["400"]);
        assert.ok(detailSwagger.patch.responses["400"]);
        assert.ok(detailSwagger.delete.responses["400"]);
        assert.deepEqual(detailSwagger.post.requestBody.content["application/json"].schema.required, ["unitPrice", "currencyCode", "taxRate"]);
        assert.deepEqual(detailSwagger.patch.requestBody.content["application/json"].schema.required, ["unitPrice", "currencyCode", "taxRate", "expectedVersion"]);

        let requestNumber = 0;
        const request = async (method, path, session, body) => fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `127.0.0.${++requestNumber}`,
            ...(session === undefined ? {} : { cookie: `lotus_session=${session.token}` }),
            ...(method === "GET" || session === undefined ? {} : { "x-csrf-token": session.csrf }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const path = (id) => `/product-supply-relationships/${encodeURIComponent(id)}/commercial-terms`;
        const valid = { unitPrice: "120.500000", currencyCode: "JPY", taxRate: "0.1000" };
        const create = (id, body = valid, session = adminSession) => request("POST", path(id), session, body);
        const update = (id, body, session = adminSession) => request("PATCH", path(id), session, body);
        const clear = (id, body, session = adminSession) => request("DELETE", path(id), session, body);

        assert.equal((await request("GET", path(relationship.id))).status, 401);
        assert.equal((await request("GET", path(relationship.id), deniedSession)).status, 403);
        assert.equal((await create(relationship.id, valid, readerSession)).status, 403);
        const unset = await request("GET", path(relationship.id), readerSession);
        assert.equal(unset.status, 200); assert.equal(unset.headers.get("cache-control"), "private, no-store");
        assert.equal((await unset.json()).terms, null);
        assert.equal((await create(relationship.id, { ...valid, currencyCode: "USD" })).status, 400);
        assert.equal((await create(relationship.id, { ...valid, unitPrice: "-1" })).status, 400);
        assert.equal((await create(relationship.id, { ...valid, taxRate: "1.0001" })).status, 400);
        assert.equal((await create(relationship.id)).status, 201);
        const createdBody = await (await request("GET", path(relationship.id), readerSession)).json();
        assert.deepEqual(Object.keys(createdBody).sort(), ["relationship", "terms"]);
        assert.equal(createdBody.terms.unitPrice, "120.500000");
        assert.equal(createdBody.terms.currencyCode, "JPY");
        assert.equal(createdBody.terms.taxRate, "0.1000");
        assert.equal(createdBody.terms.version, 1);
        assert.equal((await create(relationship.id)).status, 409);
        assert.equal((await update(relationship.id, { unitPrice: "121", currencyCode: "JPY", taxRate: "0", expectedVersion: 1 })).status, 200);
        assert.equal((await update(relationship.id, { unitPrice: "121", currencyCode: "JPY", taxRate: "0", expectedVersion: 1 })).status, 409);

        const [createA, createB] = await Promise.all([create(concurrentRelationship.id), create(concurrentRelationship.id)]);
        assert.deepEqual([createA.status, createB.status].sort(), [201, 409]);
        const concurrent = await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { relationshipId: concurrentRelationship.id } });
        const [updateA, updateB] = await Promise.all([
          update(concurrentRelationship.id, { unitPrice: "20", currencyCode: "JPY", taxRate: "0", expectedVersion: concurrent.version }),
          update(concurrentRelationship.id, { unitPrice: "21", currencyCode: "JPY", taxRate: "0", expectedVersion: concurrent.version }),
        ]);
        assert.deepEqual([updateA.status, updateB.status].sort(), [200, 409]);
        const afterUpdate = await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { relationshipId: concurrentRelationship.id } });
        const [clearA, clearB] = await Promise.all([
          clear(concurrentRelationship.id, { expectedVersion: afterUpdate.version }),
          clear(concurrentRelationship.id, { expectedVersion: afterUpdate.version }),
        ]);
        assert.deepEqual([clearA.status, clearB.status].sort(), [200, 409]);

        await prisma.productSupplyRelationship.update({ where: { id: relationship.id }, data: { status: "DISABLED", version: { increment: 1 } } });
        assert.equal((await update(relationship.id, { unitPrice: "122", currencyCode: "JPY", taxRate: "0", expectedVersion: 2 })).status, 409);
        const retained = await prisma.productSupplierCommercialTerms.findUniqueOrThrow({ where: { relationshipId: relationship.id } });
        assert.equal(retained.version, 2);
        await prisma.product.update({ where: { id: product.id }, data: { status: "INACTIVE", deletedAt: new Date() } });
        const cleared = await clear(relationship.id, { expectedVersion: 2 });
        assert.equal(cleared.status, 200); assert.equal((await cleared.json()).terms, null);
        assert.equal((await create(relationship.id)).status, 409);

        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierCommercialTerms" ("id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt") VALUES ('${fixture}-currency', '${currencyRelationship.id}', 1, 'USD', 0, 1, NOW(), NOW())`), /currency_jpy/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierCommercialTerms" ("id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt") VALUES ('${fixture}-price', '${priceRelationship.id}', -1, 'JPY', 0, 1, NOW(), NOW())`), /unitPrice_nonnegative/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierCommercialTerms" ("id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt") VALUES ('${fixture}-low-tax', '${lowTaxRelationship.id}', 1, 'JPY', -0.0001, 1, NOW(), NOW())`), /taxRate_range/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierCommercialTerms" ("id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt") VALUES ('${fixture}-high-tax', '${highTaxRelationship.id}', 1, 'JPY', 1.0001, 1, NOW(), NOW())`), /taxRate_range/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplierCommercialTerms" ("id", "relationshipId", "unitPrice", "currencyCode", "taxRate", "version", "createdAt", "updatedAt") VALUES ('${fixture}-version', '${versionRelationship.id}', 1, 'JPY', 0, 0, NOW(), NOW())`), /version_positive/i);

        assert.deepEqual(await prisma.priceMaster.findUniqueOrThrow({ where: { id: priceMaster.id } }), priceMaster);
      } finally {
        await app?.close(); await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() }); await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE)`); } finally { await cleanup.end(); }
      }
    });
  }
}
