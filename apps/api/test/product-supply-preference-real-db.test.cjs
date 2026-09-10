const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PRODUCT_SUPPLY_PREFERENCE_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c12_supply_preferences_test";

if (databaseUrl === undefined) {
  test("supply preference real database proof is opt-in", { skip: "PRODUCT_SUPPLY_PREFERENCE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("supply preference proof requires its dedicated disposable database", () => assert.fail(`PRODUCT_SUPPLY_PREFERENCE_DATABASE_URL must target ${allowedDatabaseName}.`));
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const { DocumentBuilder, SwaggerModule } = require("@nestjs/swagger");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("supply preferences are explicit, eligible only at commit, and retain operator intent", async () => {
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
      const fixture = `c12-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      let app;

      const createSession = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`; const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({ data: { userId, tokenHash: hash(token), csrfTokenHash: hash(csrf), credentialVersion: user.credentialVersion, authenticationPolicyVersion: user.authenticationPolicyVersion, expiresAt: new Date(Date.now() + 300_000), activatedAt: new Date() } });
        await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt } });
        return { token, csrf };
      };
      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
        app.use(cookieParser()); app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        return `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
      };

      try {
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "Each", symbol: "ea", dimension: "COUNT" } });
        const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const otherProduct = await prisma.product.create({ data: { code: `${fixture}-OTHER`, name: "Other", baseUnitId: unit.id, inventoryUnitId: unit.id } });
        const [supplierA, supplierB] = await Promise.all([
          prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER-A`, name: "Supplier A" } }),
          prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER-B`, name: "Supplier B" } }),
        ]);
        const [relationshipA, relationshipB, otherRelationship] = await Promise.all([
          prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplierA.id } }),
          prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplierB.id } }),
          prisma.productSupplyRelationship.create({ data: { productId: otherProduct.id, supplierId: supplierA.id } }),
        ]);
        const [packageA1, packageA2, packageB] = await Promise.all([
          prisma.productSupplierPackage.create({ data: { relationshipId: relationshipA.id, code: "CASE", name: "Case", inventoryQuantityPerPackage: "10", isOrderable: true } }),
          prisma.productSupplierPackage.create({ data: { relationshipId: relationshipA.id, code: "PALLET", name: "Pallet", inventoryQuantityPerPackage: "100", isOrderable: true } }),
          prisma.productSupplierPackage.create({ data: { relationshipId: relationshipB.id, code: "B-CASE", name: "B case", inventoryQuantityPerPackage: "20", isOrderable: true } }),
        ]);
        const price = await prisma.priceMaster.create({ data: { productId: product.id, supplierId: supplierA.id, currentUnitPrice: "10.000000" } });
        const purchaseBefore = await prisma.purchase.create({ data: { supplierId: supplierA.id, purchaseDate: new Date("2026-09-11T00:00:00.000Z"), documentNumber: `${fixture}-purchase`, items: { create: { productId: product.id, unitId: unit.id, lineNumber: 1, quantity: "1", unitPrice: "10", lineAmount: "10", taxRate: "0" } } } });

        const [admin, reader, denied] = await Promise.all([
          prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "admin", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-reader@example.test`, displayName: "reader", passwordHash: "not-used" } }),
          prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "denied", passwordHash: "not-used" } }),
        ]);
        const [readRole, deniedRole] = await Promise.all([
          prisma.role.create({ data: { code: `${fixture}-READ`, name: "read" } }),
          prisma.role.create({ data: { code: `${fixture}-DENIED`, name: "denied" } }),
        ]);
        const masterRead = await prisma.permission.findUniqueOrThrow({ where: { code: "master.read" } });
        await prisma.rolePermission.create({ data: { roleId: readRole.id, permissionId: masterRead.id } });
        await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: "rbac-role-system-admin" }, { userId: reader.id, roleId: readRole.id }, { userId: denied.id, roleId: deniedRole.id }] });
        const [adminSession, readerSession, deniedSession] = await Promise.all([createSession(admin.id, "admin"), createSession(reader.id, "reader"), createSession(denied.id, "denied")]);
        const baseUrl = await startApp();
        assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { status: "ok" });
        const swagger = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("C12").build());
        assert.equal(swagger.paths["/api/v1/products/{productId}/supply-preference"].get.responses["200"].content["application/json"].schema.additionalProperties, false);
        assert.equal(swagger.paths["/api/v1/product-supply-relationships/{relationshipId}/package-preference"].put.responses["200"].content["application/json"].schema.additionalProperties, false);

        let requestNumber = 0;
        const request = (method, path, session, body) => fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": `127.0.0.${++requestNumber}`, ...(session === undefined ? {} : { cookie: `lotus_session=${session.token}` }), ...(method === "GET" || session === undefined ? {} : { "x-csrf-token": session.csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const supplierPath = `/products/${product.id}/supply-preference`;
        const packagePath = `/product-supply-relationships/${relationshipA.id}/package-preference`;
        const setSupplier = (relationshipId, expectedVersion, session = adminSession) => request("PUT", supplierPath, session, { relationshipId, expectedVersion });
        const clearSupplier = (expectedVersion, session = adminSession) => request("DELETE", supplierPath, session, { expectedVersion });
        const setPackage = (packageId, expectedVersion, session = adminSession) => request("PUT", packagePath, session, { packageId, expectedVersion });
        const clearPackage = (expectedVersion, session = adminSession) => request("DELETE", packagePath, session, { expectedVersion });

        assert.equal((await request("GET", supplierPath)).status, 401);
        assert.equal((await request("GET", supplierPath, deniedSession)).status, 403);
        assert.equal((await setSupplier(relationshipA.id, null, readerSession)).status, 403);
        const emptySupplier = await request("GET", supplierPath, readerSession);
        assert.equal(emptySupplier.status, 200); assert.equal(emptySupplier.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(Object.keys(await emptySupplier.json()).sort(), ["preference", "product"]);
        assert.equal((await request("PUT", supplierPath, adminSession, { relationshipId: relationshipA.id, expectedVersion: null, extra: true })).status, 400);
        assert.equal((await setSupplier(otherRelationship.id, null)).status, 409);
        const initialSupplier = await setSupplier(relationshipA.id, null);
        assert.equal(initialSupplier.status, 200); const initialSupplierBody = await initialSupplier.json();
        assert.equal(initialSupplierBody.preference.relationshipId, relationshipA.id); assert.equal(initialSupplierBody.preference.version, 1); assert.equal(initialSupplierBody.preference.isEligible, true);
        assert.equal((await setSupplier(relationshipB.id, null)).status, 409);
        const replacement = await setSupplier(relationshipB.id, 1);
        assert.equal(replacement.status, 200); assert.equal((await replacement.json()).preference.version, 2);
        assert.equal((await clearSupplier(1)).status, 409);
        assert.equal((await clearSupplier(2)).status, 200);

        const [setA, setB] = await Promise.all([setSupplier(relationshipA.id, null), setSupplier(relationshipB.id, null)]);
        assert.deepEqual([setA.status, setB.status].sort(), [200, 409]);
        const selectedSupplier = await request("GET", supplierPath, adminSession); const selectedSupplierBody = await selectedSupplier.json();
        const [clearRace, replaceRace] = await Promise.all([clearSupplier(selectedSupplierBody.preference.version), setSupplier(relationshipB.id, selectedSupplierBody.preference.version)]);
        assert.deepEqual([clearRace.status, replaceRace.status].sort(), [200, 409]);
        let supplierContext = await (await request("GET", supplierPath, adminSession)).json();
        if (supplierContext.preference !== null) assert.equal((await clearSupplier(supplierContext.preference.version)).status, 200);

        const lifecycleRace = async (lockSql, id, updateSql, body) => {
          const client = new Client({ connectionString: databaseUrl }); let open = false;
          try {
            await client.connect(); await client.query("BEGIN"); open = true;
            await client.query(lockSql, [id]); const pending = body();
            await new Promise((resolve) => setTimeout(resolve, 50)); await client.query(updateSql, [id]); await client.query("COMMIT"); open = false;
            return await pending;
          } finally { if (open) await client.query("ROLLBACK"); await client.end(); }
        };
        assert.equal((await lifecycleRace('SELECT "id" FROM "Product" WHERE "id" = $1 FOR UPDATE', product.id, 'UPDATE "Product" SET "status" = \'INACTIVE\' WHERE "id" = $1', () => setSupplier(relationshipA.id, null))).status, 409);
        await prisma.product.update({ where: { id: product.id }, data: { status: "ACTIVE" } });
        assert.equal((await lifecycleRace('SELECT "id" FROM "Supplier" WHERE "id" = $1 FOR UPDATE', supplierA.id, 'UPDATE "Supplier" SET "status" = \'INACTIVE\' WHERE "id" = $1', () => setSupplier(relationshipA.id, null))).status, 409);
        await prisma.supplier.update({ where: { id: supplierA.id }, data: { status: "ACTIVE" } });
        assert.equal((await lifecycleRace('SELECT "id" FROM "ProductSupplyRelationship" WHERE "id" = $1 FOR UPDATE', relationshipA.id, 'UPDATE "ProductSupplyRelationship" SET "status" = \'DISABLED\' WHERE "id" = $1', () => setSupplier(relationshipA.id, null))).status, 409);
        await prisma.productSupplyRelationship.update({ where: { id: relationshipA.id }, data: { status: "ACTIVE" } });
        const retainedSupplier = await setSupplier(relationshipA.id, null); assert.equal(retainedSupplier.status, 200);
        await prisma.productSupplyRelationship.update({ where: { id: relationshipA.id }, data: { status: "DISABLED" } });
        supplierContext = await (await request("GET", supplierPath, adminSession)).json(); assert.equal(supplierContext.preference.isEligible, false);
        assert.equal(await prisma.productSupplyPreference.count({ where: { productId: product.id } }), 1);
        assert.equal((await clearSupplier(supplierContext.preference.version)).status, 200);
        await prisma.productSupplyRelationship.update({ where: { id: relationshipA.id }, data: { status: "ACTIVE" } });

        assert.equal((await request("GET", packagePath)).status, 401);
        assert.equal((await request("GET", packagePath, deniedSession)).status, 403);
        assert.equal((await setPackage(packageA1.id, null, readerSession)).status, 403);
        assert.equal((await setPackage(packageB.id, null)).status, 409);
        const initialPackage = await setPackage(packageA1.id, null); assert.equal(initialPackage.status, 200); const initialPackageBody = await initialPackage.json();
        assert.equal(initialPackageBody.preference.packageId, packageA1.id); assert.equal(initialPackageBody.preference.isEligible, true);
        assert.equal((await clearPackage(1)).status, 200);
        const [setPackageA, setPackageB] = await Promise.all([setPackage(packageA1.id, null), setPackage(packageA2.id, null)]);
        assert.deepEqual([setPackageA.status, setPackageB.status].sort(), [200, 409]);
        let packageContext = await (await request("GET", packagePath, adminSession)).json();
        const [clearPackageRace, replacePackageRace] = await Promise.all([clearPackage(packageContext.preference.version), setPackage(packageA2.id, packageContext.preference.version)]);
        assert.deepEqual([clearPackageRace.status, replacePackageRace.status].sort(), [200, 409]);
        packageContext = await (await request("GET", packagePath, adminSession)).json(); if (packageContext.preference !== null) assert.equal((await clearPackage(packageContext.preference.version)).status, 200);
        assert.equal((await lifecycleRace('SELECT "id" FROM "ProductSupplyRelationship" WHERE "id" = $1 FOR UPDATE', relationshipA.id, 'UPDATE "ProductSupplyRelationship" SET "status" = \'DISABLED\' WHERE "id" = $1', () => setPackage(packageA1.id, null))).status, 409);
        await prisma.productSupplyRelationship.update({ where: { id: relationshipA.id }, data: { status: "ACTIVE" } });
        assert.equal((await lifecycleRace('SELECT "id" FROM "ProductSupplierPackage" WHERE "id" = $1 FOR UPDATE', packageA1.id, 'UPDATE "ProductSupplierPackage" SET "status" = \'DISABLED\' WHERE "id" = $1', () => setPackage(packageA1.id, null))).status, 409);
        await prisma.productSupplierPackage.update({ where: { id: packageA1.id }, data: { status: "ACTIVE" } });
        assert.equal((await lifecycleRace('SELECT "id" FROM "ProductSupplierPackage" WHERE "id" = $1 FOR UPDATE', packageA1.id, 'UPDATE "ProductSupplierPackage" SET "isOrderable" = false WHERE "id" = $1', () => setPackage(packageA1.id, null))).status, 409);
        assert.equal((await setPackage(packageA1.id, null)).status, 409);
        await prisma.productSupplierPackage.update({ where: { id: packageA1.id }, data: { isOrderable: true } });
        const retainedPackage = await setPackage(packageA1.id, null); assert.equal(retainedPackage.status, 200);
        await prisma.productSupplierPackage.update({ where: { id: packageA1.id }, data: { isOrderable: false } });
        packageContext = await (await request("GET", packagePath, adminSession)).json(); assert.equal(packageContext.preference.isEligible, false);
        assert.equal(await prisma.productSupplierPackagePreference.count({ where: { relationshipId: relationshipA.id } }), 1);

        assert.equal(purchaseBefore.status, "DRAFT");
        assert.deepEqual(await prisma.priceMaster.findUniqueOrThrow({ where: { id: price.id } }), price);
        await assert.rejects(() => prisma.$executeRawUnsafe(`INSERT INTO "ProductSupplyPreference" ("id", "productId", "relationshipId", "version", "createdAt", "updatedAt") VALUES ('${fixture}-bad-version', '${otherProduct.id}', '${otherRelationship.id}', 0, NOW(), NOW())`), /version_positive/i);
        await assert.rejects(() => prisma.$executeRawUnsafe(`DELETE FROM "ProductSupplyRelationship" WHERE "id" = '${relationshipA.id}'`), /foreign key/i);
      } finally {
        await app?.close(); await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() }); await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE)`); } finally { await cleanup.end(); }
      }
    });
  }
}
