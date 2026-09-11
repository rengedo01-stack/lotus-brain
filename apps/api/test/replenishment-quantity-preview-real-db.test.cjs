const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.REPLENISHMENT_QUANTITY_PREVIEW_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c14_quantity_preview_test";

if (databaseUrl === undefined) {
  test("replenishment quantity preview real database proof is opt-in", { skip: "REPLENISHMENT_QUANTITY_PREVIEW_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("replenishment quantity preview real database proof requires its dedicated disposable database", () => {
      assert.fail(`REPLENISHMENT_QUANTITY_PREVIEW_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const sha256 = (value) => createHash("sha256").update(value).digest("hex");

    test("replenishment quantity preview uses one exact, read-only snapshot and never subtracts unposted purchases", async () => {
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
      const fixture = `pr006c14-${randomUUID()}`;
      let app;

      const sessionFor = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({ data: {
          userId, tokenHash: sha256(token), csrfTokenHash: sha256(csrf), credentialVersion: user.credentialVersion,
          authenticationPolicyVersion: user.authenticationPolicyVersion, expiresAt: new Date(Date.now() + 5 * 60_000), activatedAt: new Date(),
        } });
        await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: sha256(csrf), expiresAt: session.expiresAt } });
        return token;
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
        const unit = await prisma.unit.create({ data: { code: `${fixture}-EA`, name: "PR-006C14 each", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
        const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUP`, name: "PR-006C14 supplier" } });
        const inactiveSupplier = await prisma.supplier.create({ data: { code: `${fixture}-INACTIVE-SUP`, name: "PR-006C14 inactive supplier", status: "INACTIVE" } });
        const createProduct = async (suffix, { current, reorder = "5", target = "12", preferred = true, terms = { minimumOrderQuantity: "12", orderMultipleQuantity: "5" }, packagePreference = "active", status = "ACTIVE", deletedAt = null, supplierValue = supplier } = {}) => {
          const product = await prisma.product.create({ data: { code: `${fixture}-${suffix}`, name: `PR-006C14 ${suffix}`, baseUnitId: unit.id, inventoryUnitId: unit.id, status, deletedAt } });
          if (current !== null) await prisma.inventory.create({ data: { productId: product.id, quantity: current ?? "5" } });
          if (reorder !== null) await prisma.replenishmentPolicy.create({ data: { productId: product.id, reorderPointQuantity: reorder, targetStockQuantity: target } });
          const relationship = await prisma.productSupplyRelationship.create({ data: { productId: product.id, supplierId: supplierValue.id } });
          if (preferred) await prisma.productSupplyPreference.create({ data: { productId: product.id, relationshipId: relationship.id } });
          if (terms !== null) await prisma.productSupplierOrderingTerms.create({ data: { relationshipId: relationship.id, ...terms } });
          if (packagePreference !== "none") {
            const packageRow = await prisma.productSupplierPackage.create({ data: {
              relationshipId: relationship.id, code: `${suffix}-CASE`, name: `${suffix} case`, inventoryQuantityPerPackage: "6", isOrderable: packagePreference !== "not-orderable", status: packagePreference === "disabled" ? "DISABLED" : "ACTIVE",
            } });
            await prisma.productSupplierPackagePreference.create({ data: { relationshipId: relationship.id, packageId: packageRow.id } });
          }
          return { product, relationship };
        };

        const constrained = await createProduct("CONSTRAINED", { current: "5", reorder: "5", target: "12" });
        const noPackage = await createProduct("NO-PACKAGE", { current: "5", reorder: "5", target: "12", packagePreference: "none" });
        const noTerms = await createProduct("NO-TERMS", { current: "5", reorder: "5", target: "12", terms: null, packagePreference: "none" });
        const nullTerms = await createProduct("NULL-TERMS", { current: "5", reorder: "5", target: "12", terms: { minimumOrderQuantity: null, orderMultipleQuantity: null }, packagePreference: "none" });
        const targetUnset = await createProduct("TARGET-UNSET", { current: "5", reorder: "5", target: null, packagePreference: "none" });
        const gapZero = await createProduct("GAP-ZERO", { current: "12", reorder: "12", target: "12", packagePreference: "none" });
        const negative = await createProduct("NEGATIVE", { current: "-1", reorder: "5", target: "12", packagePreference: "none" });
        const noPreferred = await createProduct("NO-PREFERRED", { current: "5", reorder: "5", target: "12", preferred: false, packagePreference: "none" });
        const packageDisabled = await createProduct("PACKAGE-DISABLED", { current: "5", reorder: "5", target: "12", packagePreference: "disabled" });
        const packageNotOrderable = await createProduct("PACKAGE-NOT-ORDERABLE", { current: "5", reorder: "5", target: "12", packagePreference: "not-orderable" });
        const supplierInactive = await createProduct("SUPPLIER-INACTIVE", { current: "5", reorder: "5", target: "12", packagePreference: "none", supplierValue: inactiveSupplier });
        const aboveReorder = await createProduct("NOT-CANDIDATE", { current: "6", reorder: "5", target: "12", packagePreference: "none" });
        const noInventory = await createProduct("NO-INVENTORY", { current: null, reorder: "5", target: "12", packagePreference: "none" });
        const inactiveProduct = await createProduct("INACTIVE", { current: "5", reorder: "5", target: "12", status: "INACTIVE", packagePreference: "none" });

        const relationshipDisabled = await createProduct("RELATIONSHIP-DISABLED", { current: "5", reorder: "5", target: "12", packagePreference: "none" });
        await prisma.productSupplyRelationship.update({ where: { id: relationshipDisabled.relationship.id }, data: { status: "DISABLED" } });

        const createPurchase = async (suffix, productId, quantity, status) => {
          const purchase = await prisma.purchase.create({ data: {
            supplierId: supplier.id, purchaseDate: new Date("2026-09-11T00:00:00.000Z"), documentNumber: `${fixture}-${suffix}`,
            items: { create: { productId, unitId: unit.id, lineNumber: 1, quantity, unitPrice: "1", lineAmount: quantity, taxRate: "0" } },
          } });
          if (status !== "DRAFT") await prisma.purchase.update({ where: { id: purchase.id }, data: status === "CONFIRMED" ? { status: "CONFIRMED" } : status === "POSTED" ? { status: "POSTED", postedAt: new Date() } : { status: "CANCELLED", cancelledAt: new Date() } });
        };
        await createPurchase("DRAFT-1", constrained.product.id, "100", "DRAFT");
        await createPurchase("DRAFT-2", constrained.product.id, "25", "DRAFT");
        await createPurchase("CONFIRMED", constrained.product.id, "200", "CONFIRMED");
        await createPurchase("POSTED", constrained.product.id, "300", "POSTED");
        await createPurchase("CANCELLED", constrained.product.id, "400", "CANCELLED");

        const permissions = await Promise.all(["inventory.read", "purchase.read", "master.read"].map((code) => prisma.permission.findUniqueOrThrow({ where: { code } })));
        const createUserToken = async (suffix, permissionIndexes) => {
          const user = await prisma.user.create({ data: { email: `${fixture}-${suffix}@example.test`, displayName: `PR-006C14 ${suffix}`, passwordHash: "not-used" } });
          if (permissionIndexes.length === 3) await prisma.userRole.create({ data: { userId: user.id, roleId: "rbac-role-system-admin" } });
          else {
            const role = await prisma.role.create({ data: { code: `${fixture}-${suffix}`, name: `PR-006C14 ${suffix}` } });
            await prisma.rolePermission.createMany({ data: permissionIndexes.map((index) => ({ roleId: role.id, permissionId: permissions[index].id })) });
            await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
          }
          return sessionFor(user.id, suffix);
        };
        const [all, inventoryOnly, purchaseOnly, masterOnly, inventoryPurchase, inventoryMaster, purchaseMaster] = await Promise.all([
          createUserToken("all", [0, 1, 2]), createUserToken("inventory", [0]), createUserToken("purchase", [1]), createUserToken("master", [2]), createUserToken("inventory-purchase", [0, 1]), createUserToken("inventory-master", [0, 2]), createUserToken("purchase-master", [1, 2]),
        ]);
        const baseUrl = await startApp();
        let requestNumber = 0;
        const get = (productId, token) => {
          requestNumber += 1;
          return fetch(`${baseUrl}/inventory/${encodeURIComponent(productId)}/replenishment-quantity-preview`, { headers: { "x-forwarded-for": `127.0.0.${requestNumber}`, ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }) } });
        };

        assert.equal((await get(constrained.product.id)).status, 401);
        for (const token of [inventoryOnly, purchaseOnly, masterOnly, inventoryPurchase, inventoryMaster, purchaseMaster]) assert.equal((await get(constrained.product.id, token)).status, 403);

        const before = await prisma.$transaction(async (tx) => ({
          purchaseCount: await tx.purchase.count(), inventory: await tx.inventory.findUniqueOrThrow({ where: { productId: constrained.product.id } }), policy: await tx.replenishmentPolicy.findUniqueOrThrow({ where: { productId: constrained.product.id } }),
        }), { isolationLevel: "RepeatableRead" });
        const response = await get(constrained.product.id, all);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ["confirmedPurchaseQuantity", "currentQuantity", "draftPurchaseQuantity", "inventoryUnit", "orderingTerms", "preferredPackage", "preferredSupplier", "product", "reorderPointQuantity", "result", "targetStockQuantity"]);
        assert.deepEqual(Object.keys(body.result).sort(), ["feasibleQuantity", "overOrderQuantity", "packageCount", "rawTargetGap", "status"]);
        assert.equal(body.currentQuantity, "5.000000000");
        assert.equal(body.targetStockQuantity, "12.000000000");
        assert.equal(body.draftPurchaseQuantity, "125.000000000");
        assert.equal(body.confirmedPurchaseQuantity, "200.000000000");
        assert.deepEqual(body.result, { status: "READY", rawTargetGap: "7", feasibleQuantity: "30", overOrderQuantity: "23", packageCount: "5" });
        assert.equal(JSON.stringify(body).match(/price|cost|forecast|projected|purchaseId|recommendation/i), null);
        const after = await prisma.$transaction(async (tx) => ({
          purchaseCount: await tx.purchase.count(), inventory: await tx.inventory.findUniqueOrThrow({ where: { productId: constrained.product.id } }), policy: await tx.replenishmentPolicy.findUniqueOrThrow({ where: { productId: constrained.product.id } }),
        }), { isolationLevel: "RepeatableRead" });
        assert.equal(after.purchaseCount, before.purchaseCount);
        assert.equal(after.inventory.quantity.toString(), before.inventory.quantity.toString());
        assert.equal(after.inventory.version, before.inventory.version);
        assert.equal(after.inventory.updatedAt.toISOString(), before.inventory.updatedAt.toISOString());
        assert.equal(after.policy.version, before.policy.version);
        assert.equal(after.policy.updatedAt.toISOString(), before.policy.updatedAt.toISOString());

        const bodyFor = async (record) => { const responseValue = await get(record.product.id, all); assert.equal(responseValue.status, 200); return responseValue.json(); };
        assert.deepEqual((await bodyFor(noPackage)).result, { status: "READY", rawTargetGap: "7", feasibleQuantity: "15", overOrderQuantity: "8", packageCount: null });
        assert.deepEqual((await bodyFor(noTerms)).result, { status: "READY", rawTargetGap: "7", feasibleQuantity: "7", overOrderQuantity: "0", packageCount: null });
        assert.deepEqual((await bodyFor(nullTerms)).result, { status: "READY", rawTargetGap: "7", feasibleQuantity: "7", overOrderQuantity: "0", packageCount: null });
        assert.equal((await bodyFor(targetUnset)).result.status, "TARGET_NOT_CONFIGURED");
        assert.equal((await bodyFor(gapZero)).result.status, "NO_POSITIVE_NEED");
        assert.equal((await bodyFor(negative)).result.status, "INVENTORY_RECONCILIATION_REQUIRED");
        assert.equal((await bodyFor(noPreferred)).result.status, "NO_PREFERRED_SUPPLIER");
        assert.equal((await bodyFor(packageDisabled)).result.status, "PREFERRED_PACKAGE_INELIGIBLE");
        assert.equal((await bodyFor(packageNotOrderable)).result.status, "PREFERRED_PACKAGE_INELIGIBLE");
        assert.equal((await bodyFor(relationshipDisabled)).result.status, "PREFERRED_SUPPLIER_INELIGIBLE");
        assert.equal((await bodyFor(supplierInactive)).result.status, "PREFERRED_SUPPLIER_INELIGIBLE");
        assert.equal((await bodyFor(aboveReorder)).result.status, "NOT_A_REPLENISHMENT_CANDIDATE");
        assert.equal((await bodyFor(noInventory)).result.status, "NOT_A_REPLENISHMENT_CANDIDATE");
        assert.equal((await bodyFor(inactiveProduct)).result.status, "NOT_A_REPLENISHMENT_CANDIDATE");
        assert.equal((await get("not-a-product", all)).status, 404);

        // The endpoint specifies RepeatableRead itself. This PostgreSQL probe
        // also documents the snapshot guarantee used by the preview: a second
        // committed write is invisible inside an already-open RR transaction.
        const concurrentWriter = new Client({ connectionString: databaseUrl });
        await concurrentWriter.connect();
        try {
          await prisma.$transaction(async (tx) => {
            const first = await tx.inventory.findUniqueOrThrow({ where: { productId: constrained.product.id } });
            await concurrentWriter.query('UPDATE "Inventory" SET "quantity" = $1, "version" = "version" + 1 WHERE "productId" = $2', ["6", constrained.product.id]);
            const second = await tx.inventory.findUniqueOrThrow({ where: { productId: constrained.product.id } });
            assert.equal(second.quantity.toString(), first.quantity.toString());
          }, { isolationLevel: "RepeatableRead" });
        } finally { await concurrentWriter.end(); }
      } finally {
        await app?.close();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl); cleanupUrl.pathname = "/postgres"; cleanupUrl.searchParams.delete("schema");
        const cleanup = new Client({ connectionString: cleanupUrl.toString() });
        await cleanup.connect();
        try { await cleanup.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`); } finally { await cleanup.end(); }
      }
    });
  }
}
