const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const { readDisposableDatabaseUrl } = require("./support/disposable-database.cjs");
const databaseUrl = readDisposableDatabaseUrl("PURCHASE_POSTED_REVERSAL_DATABASE_URL");
const allowedDatabaseName = "lotus_brain_pr006c24c2a_purchase_posted_reversal_test";

if (databaseUrl === undefined) {
  test("purchase posted reversal real database proof is opt-in", { skip: "PURCHASE_POSTED_REVERSAL_DATABASE_URL is not set" }, () => {});
} else if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== allowedDatabaseName) {
  test("purchase posted reversal proof requires its dedicated disposable database", () => {
    assert.fail(`PURCHASE_POSTED_REVERSAL_DATABASE_URL must target ${allowedDatabaseName}.`);
  });
} else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { Client } = require("pg");
  const { NestFactory } = require("@nestjs/core");
  const { ValidationPipe } = require("@nestjs/common");
  const cookieParser = require("cookie-parser");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { PrismaPurchaseDraftRepository } = require("../dist/modules/purchase/infrastructure/purchase-draft.repository.js");
  const { PrismaStocktakeRepository } = require("../dist/modules/stocktake/infrastructure/prisma-stocktake.repository.js");

  const hash = (value) => createHash("sha256").update(value).digest("hex");

  test("posted purchase correction is current-time, immutable, idempotent, and source-safe", async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGIN = "http://localhost:3000";
    process.env.PUBLIC_WEB_BASE_URL = "http://localhost:3000";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
    process.env.LOG_LEVEL = "error";
    process.env.CSRF_LEGACY_SCALAR_FALLBACK = "false";

    const { AppModule } = require("../dist/app.module.js");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const fixture = `pr006c24c2a-${randomUUID()}`;
    const sessionToken = `${fixture}-session`;
    const csrfToken = `${fixture}-csrf`;
    let app;

    const startApp = async () => {
      app = await NestFactory.create(AppModule, { logger: false });
      app.getHttpAdapter().getInstance().set("trust proxy", 1);
      app.use(cookieParser());
      app.setGlobalPrefix("api/v1");
      app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
      await app.listen(0, "127.0.0.1");
      return `http://127.0.0.1:${app.getHttpServer().address().port}`;
    };

    try {
      const unit = await prisma.unit.create({ data: { code: `${fixture}-unit`, name: "reversal unit", symbol: "ea", dimension: "COUNT", status: "ACTIVE" } });
      const supplier = await prisma.supplier.create({ data: { code: `${fixture}-supplier`, name: "reversal supplier", status: "ACTIVE" } });
      const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "reversal admin", passwordHash: "not-used" } });
      await prisma.userRole.create({ data: { userId: admin.id, roleId: "rbac-role-system-admin" } });
      const session = await prisma.identitySession.create({ data: {
        userId: admin.id, tokenHash: hash(sessionToken), csrfTokenHash: hash(csrfToken),
        credentialVersion: admin.credentialVersion, authenticationPolicyVersion: admin.authenticationPolicyVersion,
        expiresAt: new Date(Date.now() + 60_000), activatedAt: new Date(),
      } });
      await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: hash(csrfToken), expiresAt: session.expiresAt } });

      const drafts = new PrismaPurchaseDraftRepository(prisma);
      const createProduct = async (suffix) => {
        const product = await prisma.product.create({ data: {
          code: `${fixture}-${suffix}`, name: `reversal ${suffix}`, baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE",
        } });
        await prisma.inventory.create({ data: { productId: product.id, quantity: "0", averageUnitCost: null } });
        return product;
      };
      const createConfirmed = async (product, documentNumber, quantity = "2.000000000", unitPrice = "100.000000") => {
        const purchase = await drafts.create({
          supplierId: supplier.id, purchaseDate: "2026-09-20T00:00:00.000Z", documentNumber,
          items: [{ productId: product.id, unitId: unit.id, quantity, unitPrice, taxRate: "0" }],
        });
        const confirmed = await drafts.confirm(purchase.id);
        assert.notEqual(confirmed, "NOT_FOUND");
        assert.notEqual(confirmed, "CONFLICT");
        return purchase;
      };
      const createConfirmedLines = async (product, documentNumber, quantities, unitPrice = "100.000000") => {
        const purchase = await drafts.create({
          supplierId: supplier.id, purchaseDate: "2026-09-20T00:00:00.000Z", documentNumber,
          items: quantities.map((quantity) => ({ productId: product.id, unitId: unit.id, quantity, unitPrice, taxRate: "0" })),
        });
        const confirmed = await drafts.confirm(purchase.id);
        assert.notEqual(confirmed, "NOT_FOUND");
        assert.notEqual(confirmed, "CONFLICT");
        return purchase;
      };

      const baseUrl = await startApp();
      let requestNumber = 0;
      const request = (path, options = {}) => {
        const method = options.method ?? "GET";
        requestNumber += 1;
        return fetch(`${baseUrl}/api/v1${path}`, {
          method,
          headers: {
            ...(options.headers ?? {}),
            ...(options.anonymous ? {} : { cookie: `lotus_session=${sessionToken}` }),
            "x-forwarded-for": `127.0.0.${requestNumber}`,
            ...(method === "GET" || options.noCsrf ? {} : { "x-csrf-token": csrfToken }),
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      };
      const post = async (purchaseId) => assert.equal((await request(`/purchases/${purchaseId}/post`, { method: "POST" })).status, 200);
      const reversalPayload = (preview, reason) => ({
        reason,
        previewVersion: preview.previewVersion,
        idempotencyKey: randomUUID(),
        priceResolutions: preview.priceEffects
          .filter((effect) => effect.requiresPriceResolution)
          .map((effect) => ({
            productId: effect.productId,
            expectedPriceMasterVersion: effect.version,
            currentUnitPrice: effect.currentUnitPrice,
            currency: effect.currency,
          })),
      });
      const previewReversal = async (purchaseId) => {
        const response = await request(`/purchases/${purchaseId}/reversal-preview`);
        assert.equal(response.status, 200);
        return response.json();
      };
      const createConfirmedStocktake = async (product, countedQuantity, note) => {
        const stocktakes = new PrismaStocktakeRepository(prisma);
        const draft = await stocktakes.create({
          note,
          items: [{ productId: product.id, countedQuantity }],
        });
        const confirmed = await stocktakes.confirm(draft.id);
        assert.notEqual(confirmed, "NOT_FOUND");
        assert.notEqual(confirmed, "CONFLICT");
        return draft;
      };
      const createConfirmedProduction = async (ingredient, suffix, consumptionQuantity) => {
        const output = await createProduct(`production-${suffix}-output`);
        const recipeId = randomUUID();
        await prisma.recipe.create({ data: {
          id: recipeId,
          rootRecipeId: recipeId,
          name: `${fixture} reversal race ${suffix}`,
          outputProductId: output.id,
          yieldQuantity: "1.000000000",
          yieldUnitId: unit.id,
          status: "DRAFT",
          revision: 1,
        } });
        await prisma.recipeItem.create({ data: {
          recipeId,
          productId: ingredient.id,
          unitId: unit.id,
          quantity: consumptionQuantity,
          sortOrder: 0,
        } });
        await prisma.recipe.update({ where: { id: recipeId }, data: { status: "ACTIVE" } });
        const createdResponse = await request("/productions", { method: "POST", body: {
          recipeId,
          productionDate: "2026-09-21T00:00:00.000Z",
          plannedQuantity: "1.000000000",
          note: `${fixture} reversal race ${suffix}`,
        } });
        assert.equal(createdResponse.status, 201);
        const created = await createdResponse.json();
        assert.equal((await request(`/productions/${created.id}/confirm`, { method: "POST", body: {} })).status, 201);
        return { id: created.id, output };
      };

      // This is a database-level barrier, not a timing delay: reversal reaches
      // the target Inventory update only after it owns the row lock; its
      // competitor must then be observable as waiting on that database lock.
      const waitForDatabaseCondition = async (description, condition) => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (await condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Timed out waiting for ${description}.`);
      };
      const runGatedReversalRace = async ({ inventoryId, reverse, compete }) => {
        const token = randomUUID().replace(/-/g, "").slice(0, 16);
        const functionName = `pr006c24c2a_gate_${token}`;
        const triggerName = `${functionName}_trigger`;
        const advisoryKey = Number.parseInt(token.slice(0, 7), 16);
        const gate = new Client({ connectionString: databaseUrl });
        const escapedInventoryId = inventoryId.replace(/'/g, "''");
        let advisoryLocked = false;
        let triggerCreated = false;
        try {
          await gate.connect();
          await gate.query("SELECT pg_advisory_lock($1)", [advisoryKey]);
          advisoryLocked = true;
          await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$
            BEGIN
              IF OLD."id" = '${escapedInventoryId}'
                AND EXISTS (SELECT 1 FROM "PurchaseReversalInventoryEffect" WHERE "inventoryId" = OLD."id") THEN
                PERFORM pg_advisory_xact_lock(${advisoryKey});
              END IF;
              RETURN NEW;
            END;
          $$ LANGUAGE plpgsql;`);
          await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF "quantity" ON "Inventory" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
          triggerCreated = true;

          const reversePromise = reverse();
          await waitForDatabaseCondition("the reversal transaction barrier", async () => {
            const result = await gate.query(
              "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1::oid AND NOT granted) AS blocked",
              [advisoryKey],
            );
            return result.rows[0].blocked;
          });

          const competingPromise = compete();
          await waitForDatabaseCondition("the competing transaction lock wait", async () => {
            const result = await gate.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND wait_event IS DISTINCT FROM 'advisory') AS blocked");
            return result.rows[0].blocked;
          });

          await gate.query("SELECT pg_advisory_unlock($1)", [advisoryKey]);
          advisoryLocked = false;
          return Promise.all([reversePromise, competingPromise]);
        } finally {
          if (advisoryLocked) await gate.query("SELECT pg_advisory_unlock($1)", [advisoryKey]);
          if (triggerCreated) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "Inventory";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
          await gate.end();
        }
      };

      // C24C-1 legacy fixture -> this migration: no provenance is guessed.
      const legacyMaster = await prisma.priceMaster.findUniqueOrThrow({ where: { id: "legacy-price-provenance-master" } });
      const legacyHistory = await prisma.priceHistory.findUniqueOrThrow({ where: { id: "legacy-price-provenance-history" } });
      const legacyClaim = await prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { purchaseId: "legacy-price-provenance-purchase" } });
      assert.equal(legacyMaster.currentPriceHistoryId, null);
      assert.equal(legacyMaster.version, 1);
      assert.equal(legacyHistory.eventType, "LEGACY_UNKNOWN");
      assert.equal(legacyClaim.releasedAt, null);
      await assert.rejects(() => prisma.purchaseDocumentClaim.delete({ where: { id: legacyClaim.id } }), /cannot be deleted/i);

      // A: original posted history remains current, so a human must supply the replacement current price.
      const productA = await createProduct("a");
      const purchaseA = await createConfirmed(productA, `${fixture}-document-a`);
      await post(purchaseA.id);
      const itemA = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: purchaseA.id } });
      const originalReceipt = await prisma.inventoryHistory.findUniqueOrThrow({ where: { sourcePurchaseItemId: itemA.id } });
      const originalHistory = await prisma.priceHistory.findUniqueOrThrow({ where: { sourcePurchaseItemId: itemA.id } });
      const masterA = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productA.id, supplierId: supplier.id } } });
      const previewA = await (await request(`/purchases/${purchaseA.id}/reversal-preview`)).json();
      assert.equal(previewA.canReverse, true);
      assert.equal(previewA.inventoryEffects.length, 1);
      assert.equal(previewA.inventoryEffects[0].quantityDelta, "-2");
      assert.equal(previewA.priceEffects[0].source, "ORIGINAL_PURCHASE_CURRENT");
      assert.equal(previewA.priceEffects[0].requiresPriceResolution, true);
      assert.equal((await request(`/purchases/${purchaseA.id}/reversals`, { method: "POST", body: {
        reason: "input error", previewVersion: previewA.previewVersion, idempotencyKey: randomUUID(), priceResolutions: [],
      } })).status, 409);

      const requestA = {
        reason: "input error", previewVersion: previewA.previewVersion, idempotencyKey: randomUUID(),
        priceResolutions: [{ productId: productA.id, expectedPriceMasterVersion: masterA.version, currentUnitPrice: "80.000000", currency: "JPY" }],
      };
      assert.equal((await request(`/purchases/${purchaseA.id}/reversals`, { method: "POST", body: requestA })).status, 201);
      const reversalA = await prisma.purchaseReversal.findUniqueOrThrow({ where: { purchaseId: purchaseA.id }, include: { items: true, inventoryEffects: true, priceEffects: true } });
      assert.equal(reversalA.items.length, 1);
      assert.equal(reversalA.inventoryEffects.length, 1);
      assert.equal(reversalA.priceEffects.length, 1);
      assert.equal(reversalA.priceEffects[0].source, "ORIGINAL_PURCHASE_CURRENT");
      assert.equal(reversalA.priceEffects[0].becomesCurrent, true);
      assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseA.id } })).status, "POSTED");
      assert.equal((await prisma.inventoryHistory.findUniqueOrThrow({ where: { id: originalReceipt.id } })).quantityDelta.toString(), "2");
      assert.equal((await prisma.priceHistory.findUniqueOrThrow({ where: { id: originalHistory.id } })).eventType, "PURCHASE_POSTING");
      const inventoryA = await prisma.inventory.findUniqueOrThrow({ where: { productId: productA.id } });
      assert.equal(inventoryA.quantity.toString(), "0");
      assert.equal(inventoryA.averageUnitCost.toString(), "100");
      const masterANow = await prisma.priceMaster.findUniqueOrThrow({ where: { id: masterA.id } });
      assert.equal(masterANow.version, masterA.version + 1);
      assert.equal(masterANow.currentUnitPrice.toString(), "80");
      const correctionHistory = await prisma.priceHistory.findUniqueOrThrow({ where: { sourcePurchaseReversalPriceEffectId: reversalA.priceEffects[0].id } });
      assert.equal(correctionHistory.eventType, "PURCHASE_REVERSAL");
      assert.equal(masterANow.currentPriceHistoryId, correctionHistory.id);
      assert.equal(await prisma.inventoryHistory.count({ where: { sourcePurchaseReversalInventoryEffectId: reversalA.inventoryEffects[0].id, type: "PURCHASE_REVERSAL" } }), 1);
      assert.equal(await prisma.purchaseLog.count({ where: { sourcePurchaseReversalId: reversalA.id, eventType: "POSTED_REVERSED" } }), 1);
      assert.notEqual((await prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { purchaseId: purchaseA.id } })).releasedAt, null);
      await assert.rejects(() => prisma.purchaseReversal.delete({ where: { id: reversalA.id } }), /immutable/i);
      await assert.rejects(() => prisma.purchaseReversalInventoryEffect.delete({ where: { id: reversalA.inventoryEffects[0].id } }), /append-only/i);
      await assert.rejects(() => prisma.purchaseReversalPriceEffect.delete({ where: { id: reversalA.priceEffects[0].id } }), /immutable/i);
      await assert.rejects(() => prisma.priceHistory.delete({ where: { id: originalHistory.id } }), /append-only/i);

      // Retrying is safe; neither a changed payload nor another key can reverse a Purchase twice.
      const replay = await request(`/purchases/${purchaseA.id}/reversals`, { method: "POST", body: requestA });
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).id, reversalA.id);
      assert.equal((await request(`/purchases/${purchaseA.id}/reversals`, { method: "POST", body: { ...requestA, reason: "different reason" } })).status, 409);
      assert.equal((await request(`/purchases/${purchaseA.id}/reversals`, { method: "POST", body: { ...requestA, idempotencyKey: randomUUID() } })).status, 409);
      assert.ok((await createConfirmed(productA, `${fixture}-document-a`, "1.000000000", "80.000000")).id);

      // Multiple source lines of the same Product produce two immutable snapshots but one stock effect/history.
      const productMulti = await createProduct("multi");
      const purchaseMulti = await createConfirmedLines(productMulti, `${fixture}-document-multi`, ["2.000000000", "3.000000000"], "90.000000");
      await post(purchaseMulti.id);
      const masterMulti = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productMulti.id, supplierId: supplier.id } } });
      const previewMulti = await (await request(`/purchases/${purchaseMulti.id}/reversal-preview`)).json();
      assert.equal(previewMulti.inventoryEffects.length, 1);
      assert.equal(previewMulti.inventoryEffects[0].quantityDelta, "-5");
      assert.equal((await request(`/purchases/${purchaseMulti.id}/reversals`, { method: "POST", body: {
        reason: "duplicate source lines", previewVersion: previewMulti.previewVersion, idempotencyKey: randomUUID(),
        priceResolutions: [{ productId: productMulti.id, expectedPriceMasterVersion: masterMulti.version, currentUnitPrice: "75", currency: "JPY" }],
      } })).status, 201);
      const reversalMulti = await prisma.purchaseReversal.findUniqueOrThrow({ where: { purchaseId: purchaseMulti.id }, include: { items: true, inventoryEffects: true } });
      assert.equal(reversalMulti.items.length, 2);
      assert.equal(reversalMulti.inventoryEffects.length, 1);
      assert.equal(reversalMulti.inventoryEffects[0].quantityDelta.toString(), "-5");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: productMulti.id } })).quantity.toString(), "0");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: productMulti.id } })).averageUnitCost.toString(), "90");
      assert.equal(await prisma.inventoryHistory.count({ where: { sourcePurchaseReversalInventoryEffectId: reversalMulti.inventoryEffects[0].id } }), 1);

      // Insufficient current stock rejects before any correction ledger or master-data side effect.
      const productInsufficient = await createProduct("insufficient");
      const purchaseInsufficient = await createConfirmed(productInsufficient, `${fixture}-document-insufficient`);
      await post(purchaseInsufficient.id);
      const inventoryInsufficient = await prisma.inventory.findUniqueOrThrow({ where: { productId: productInsufficient.id } });
      await prisma.inventory.update({ where: { id: inventoryInsufficient.id }, data: { quantity: "1.000000000", version: { increment: 1 } } });
      const previewInsufficient = await (await request(`/purchases/${purchaseInsufficient.id}/reversal-preview`)).json();
      assert.equal(previewInsufficient.canReverse, false);
      assert.match(previewInsufficient.refusalReasons.join(" "), /insufficient/i);
      const beforeInsufficient = await Promise.all([
        prisma.inventory.findUniqueOrThrow({ where: { id: inventoryInsufficient.id } }),
        prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productInsufficient.id, supplierId: supplier.id } } }),
        prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { purchaseId: purchaseInsufficient.id } }),
      ]);
      assert.equal((await request(`/purchases/${purchaseInsufficient.id}/reversals`, { method: "POST", body: {
        reason: "must refuse", previewVersion: previewInsufficient.previewVersion, idempotencyKey: randomUUID(), priceResolutions: [],
      } })).status, 409);
      assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchaseInsufficient.id } }), 0);
      assert.equal(await prisma.inventoryHistory.count({ where: { type: "PURCHASE_REVERSAL", inventoryId: inventoryInsufficient.id } }), 0);
      assert.equal(await prisma.priceHistory.count({ where: { eventType: "PURCHASE_REVERSAL", priceMasterId: beforeInsufficient[1].id } }), 0);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: inventoryInsufficient.id } })).quantity.toString(), beforeInsufficient[0].quantity.toString());
      assert.equal((await prisma.priceMaster.findUniqueOrThrow({ where: { id: beforeInsufficient[1].id } })).version, beforeInsufficient[1].version);
      assert.equal((await prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { purchaseId: purchaseInsufficient.id } })).releasedAt, beforeInsufficient[2].releasedAt);

      // A real stocktake posting after receipt is authoritative evidence that
      // refuses a later purchase correction without writing reversal effects.
      const productStocktake = await createProduct("stocktake-refusal");
      const purchaseStocktake = await createConfirmed(productStocktake, `${fixture}-document-stocktake-refusal`);
      await post(purchaseStocktake.id);
      const stocktake = await createConfirmedStocktake(productStocktake, "2.000000000", "post-receipt stocktake");
      assert.equal((await request(`/stocktakes/${stocktake.id}/post`, { method: "POST" })).status, 200);
      const stocktakePreview = await previewReversal(purchaseStocktake.id);
      assert.equal(stocktakePreview.canReverse, false);
      assert.match(stocktakePreview.refusalReasons.join(" "), /stocktake|adjustment/i);
      assert.equal((await request(`/purchases/${purchaseStocktake.id}/reversals`, { method: "POST", body: reversalPayload(stocktakePreview, "stocktake makes correction unsafe") })).status, 409);
      assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchaseStocktake.id } }), 0);
      assert.equal(await prisma.inventoryHistory.count({ where: { type: "PURCHASE_REVERSAL", inventory: { productId: productStocktake.id } } }), 0);

      // A manual adjustment at exactly the receipt timestamp but with a later
      // ID must still refuse. This exercises the occurredAt, id tie-breaker.
      const productManual = await createProduct("manual-refusal");
      const purchaseManual = await createConfirmed(productManual, `${fixture}-document-manual-refusal`);
      await post(purchaseManual.id);
      const manualInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productManual.id } });
      const manualReceipt = await prisma.inventoryHistory.findFirstOrThrow({
        where: { inventoryId: manualInventory.id, type: "RECEIPT" },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      });
      const manualHistoryId = `${manualReceipt.id}z`;
      await prisma.$transaction(async (transaction) => {
        await transaction.inventory.update({ where: { id: manualInventory.id }, data: { quantity: "3.000000000", version: { increment: 1 } } });
        await transaction.inventoryHistory.create({ data: {
          id: manualHistoryId,
          inventoryId: manualInventory.id,
          inventoryUnitId: unit.id,
          type: "MANUAL_ADJUSTMENT",
          quantityDelta: "1.000000000",
          quantityAfter: "3.000000000",
          occurredAt: manualReceipt.occurredAt,
          note: "manual adjustment at the receipt timestamp",
        } });
      });
      const manualPreview = await previewReversal(purchaseManual.id);
      assert.equal(manualPreview.canReverse, false);
      assert.match(manualPreview.refusalReasons.join(" "), /manual adjustment|stocktake/i);
      assert.equal((await request(`/purchases/${purchaseManual.id}/reversals`, { method: "POST", body: reversalPayload(manualPreview, "manual adjustment makes correction unsafe") })).status, 409);
      assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchaseManual.id } }), 0);

      // An error after reversal records have been prepared rolls back every
      // ledger, inventory, price, and document-claim change atomically.
      const productRollback = await createProduct("forced-rollback");
      const purchaseRollback = await createConfirmed(productRollback, `${fixture}-document-forced-rollback`);
      await post(purchaseRollback.id);
      const rollbackPreview = await previewReversal(purchaseRollback.id);
      const rollbackInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productRollback.id } });
      const rollbackMaster = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productRollback.id, supplierId: supplier.id } } });
      const rollbackClaim = await prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { purchaseId: purchaseRollback.id } });
      const rollbackToken = randomUUID().replace(/-/g, "").slice(0, 16);
      const rollbackFunction = `pr006c24c2a_rollback_${rollbackToken}`;
      const rollbackTrigger = `${rollbackFunction}_trigger`;
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "${rollbackFunction}"() RETURNS TRIGGER AS $$
        BEGIN
          IF NEW."sourcePurchaseReversalInventoryEffectId" IS NOT NULL THEN
            RAISE EXCEPTION 'forced posted reversal failure';
          END IF;
          RETURN NEW;
        END;
      $$ LANGUAGE plpgsql;`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "${rollbackTrigger}" BEFORE INSERT ON "InventoryHistory" FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"();`);
      try {
        assert.equal((await request(`/purchases/${purchaseRollback.id}/reversals`, { method: "POST", body: reversalPayload(rollbackPreview, "must roll back") })).status, 500);
        assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchaseRollback.id } }), 0);
        assert.equal(await prisma.purchaseReversalInventoryEffect.count({ where: { purchaseReversal: { purchaseId: purchaseRollback.id } } }), 0);
        assert.equal(await prisma.purchaseReversalPriceEffect.count({ where: { purchaseReversal: { purchaseId: purchaseRollback.id } } }), 0);
        assert.equal(await prisma.inventoryHistory.count({ where: { inventoryId: rollbackInventory.id, type: "PURCHASE_REVERSAL" } }), 0);
        assert.equal(await prisma.priceHistory.count({ where: { priceMasterId: rollbackMaster.id, eventType: "PURCHASE_REVERSAL" } }), 0);
        const rollbackInventoryAfter = await prisma.inventory.findUniqueOrThrow({ where: { id: rollbackInventory.id } });
        const rollbackMasterAfter = await prisma.priceMaster.findUniqueOrThrow({ where: { id: rollbackMaster.id } });
        const rollbackClaimAfter = await prisma.purchaseDocumentClaim.findUniqueOrThrow({ where: { id: rollbackClaim.id } });
        assert.equal(rollbackInventoryAfter.quantity.toString(), rollbackInventory.quantity.toString());
        assert.equal(rollbackInventoryAfter.version, rollbackInventory.version);
        assert.equal(rollbackMasterAfter.currentPriceHistoryId, rollbackMaster.currentPriceHistoryId);
        assert.equal(rollbackMasterAfter.version, rollbackMaster.version);
        assert.equal(rollbackClaimAfter.releasedAt, rollbackClaim.releasedAt);
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "InventoryHistory";`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"();`);
      }

      // A preview is bound to the live Inventory version. A later receipt
      // changes the preview even though the correction itself would be safe.
      const productPreviewChanged = await createProduct("preview-inventory-change");
      const purchasePreviewChanged = await createConfirmed(productPreviewChanged, `${fixture}-document-preview-before`);
      await post(purchasePreviewChanged.id);
      const stalePreview = await previewReversal(purchasePreviewChanged.id);
      const laterPurchase = await createConfirmed(productPreviewChanged, `${fixture}-document-preview-after`, "1.000000000", "101.000000");
      await post(laterPurchase.id);
      const refreshedPreview = await previewReversal(purchasePreviewChanged.id);
      assert.equal(refreshedPreview.canReverse, true);
      assert.notEqual(refreshedPreview.previewVersion, stalePreview.previewVersion);
      assert.equal((await request(`/purchases/${purchasePreviewChanged.id}/reversals`, { method: "POST", body: reversalPayload(stalePreview, "stale after inventory receipt") })).status, 409);
      assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchasePreviewChanged.id } }), 0);

      // Four race proofs use the DB barrier above: only one reversal can win;
      // a competing receipt serializes after it; production observes the
      // corrected stock; and stocktake posting serializes without a lost write.
      const productConcurrentReversal = await createProduct("concurrent-reversal");
      const purchaseConcurrentReversal = await createConfirmed(productConcurrentReversal, `${fixture}-document-concurrent-reversal`);
      await post(purchaseConcurrentReversal.id);
      const concurrentInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productConcurrentReversal.id } });
      const concurrentPreview = await previewReversal(purchaseConcurrentReversal.id);
      const [concurrentReversal, competingReversal] = await runGatedReversalRace({
        inventoryId: concurrentInventory.id,
        reverse: () => request(`/purchases/${purchaseConcurrentReversal.id}/reversals`, { method: "POST", body: reversalPayload(concurrentPreview, "first concurrent correction") }),
        compete: () => request(`/purchases/${purchaseConcurrentReversal.id}/reversals`, { method: "POST", body: reversalPayload(concurrentPreview, "second concurrent correction") }),
      });
      assert.equal(concurrentReversal.status, 201);
      assert.equal(competingReversal.status, 409);
      assert.equal(await prisma.purchaseReversal.count({ where: { purchaseId: purchaseConcurrentReversal.id } }), 1);
      assert.equal(await prisma.inventoryHistory.count({ where: { inventoryId: concurrentInventory.id, type: "PURCHASE_REVERSAL" } }), 1);

      const productPurchaseRace = await createProduct("reversal-vs-purchase");
      const purchasePurchaseRace = await createConfirmed(productPurchaseRace, `${fixture}-document-reversal-vs-purchase-source`);
      const purchasePostingRace = await createConfirmed(productPurchaseRace, `${fixture}-document-reversal-vs-purchase-later`, "2.000000000", "111.000000");
      await post(purchasePurchaseRace.id);
      const purchaseRaceInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productPurchaseRace.id } });
      const purchaseRacePreview = await previewReversal(purchasePurchaseRace.id);
      const [purchaseRaceReversal, purchaseRacePosting] = await runGatedReversalRace({
        inventoryId: purchaseRaceInventory.id,
        reverse: () => request(`/purchases/${purchasePurchaseRace.id}/reversals`, { method: "POST", body: reversalPayload(purchaseRacePreview, "correction races receipt") }),
        compete: () => request(`/purchases/${purchasePostingRace.id}/post`, { method: "POST" }),
      });
      assert.equal(purchaseRaceReversal.status, 201);
      assert.equal(purchaseRacePosting.status, 200);
      assert.equal((await prisma.purchase.findUniqueOrThrow({ where: { id: purchasePostingRace.id } })).status, "POSTED");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: purchaseRaceInventory.id } })).quantity.toString(), "2");

      const productProductionRace = await createProduct("reversal-vs-production");
      const purchaseProductionRace = await createConfirmed(productProductionRace, `${fixture}-document-reversal-vs-production`);
      await post(purchaseProductionRace.id);
      const productionRace = await createConfirmedProduction(productProductionRace, "reversal-vs-production", "2.000000000");
      const productionRaceInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productProductionRace.id } });
      const productionRacePreview = await previewReversal(purchaseProductionRace.id);
      const [productionRaceReversal, productionRacePosting] = await runGatedReversalRace({
        inventoryId: productionRaceInventory.id,
        reverse: () => request(`/purchases/${purchaseProductionRace.id}/reversals`, { method: "POST", body: reversalPayload(productionRacePreview, "correction races production") }),
        compete: () => request(`/productions/${productionRace.id}/post`, { method: "POST", body: { actualQuantity: "1.000000000" } }),
      });
      assert.equal(productionRaceReversal.status, 201);
      assert.equal(productionRacePosting.status, 422);
      assert.equal((await prisma.production.findUniqueOrThrow({ where: { id: productionRace.id } })).status, "CONFIRMED");
      assert.equal(await prisma.inventoryHistory.count({ where: { sourceProductionConsumption: { productionId: productionRace.id } } }), 0);
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId: productionRace.output.id } })).quantity.toString(), "0");

      const productStocktakeRace = await createProduct("reversal-vs-stocktake");
      const purchaseStocktakeRace = await createConfirmed(productStocktakeRace, `${fixture}-document-reversal-vs-stocktake`);
      await post(purchaseStocktakeRace.id);
      const concurrentStocktake = await createConfirmedStocktake(productStocktakeRace, "2.000000000", "stocktake races correction");
      const stocktakeRaceInventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productStocktakeRace.id } });
      const stocktakeRacePreview = await previewReversal(purchaseStocktakeRace.id);
      const [stocktakeRaceReversal, stocktakeRacePosting] = await runGatedReversalRace({
        inventoryId: stocktakeRaceInventory.id,
        reverse: () => request(`/purchases/${purchaseStocktakeRace.id}/reversals`, { method: "POST", body: reversalPayload(stocktakeRacePreview, "correction races stocktake") }),
        compete: () => request(`/stocktakes/${concurrentStocktake.id}/post`, { method: "POST" }),
      });
      assert.equal(stocktakeRaceReversal.status, 201);
      assert.equal(stocktakeRacePosting.status, 200);
      assert.equal((await prisma.stocktake.findUniqueOrThrow({ where: { id: concurrentStocktake.id } })).status, "POSTED");
      assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { id: stocktakeRaceInventory.id } })).quantity.toString(), "0");
      assert.equal(await prisma.inventoryHistory.count({ where: { inventoryId: stocktakeRaceInventory.id, type: "PURCHASE_REVERSAL" } }), 1);
      assert.equal(await prisma.inventoryHistory.count({ where: { inventoryId: stocktakeRaceInventory.id, type: "STOCKTAKE_ADJUSTMENT" } }), 1);

      // B: a later history remains current and no price resolution is permitted or needed.
      const productB = await createProduct("b");
      const firstB = await createConfirmed(productB, `${fixture}-document-b1`, "2.000000000", "40.000000");
      await post(firstB.id);
      const masterB = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productB.id, supplierId: supplier.id } } });
      const laterB = await createConfirmed(productB, `${fixture}-document-b2`, "2.000000000", "45.000000");
      await post(laterB.id);
      const masterBAfterLater = await prisma.priceMaster.findUniqueOrThrow({ where: { id: masterB.id } });
      const previewB = await (await request(`/purchases/${firstB.id}/reversal-preview`)).json();
      assert.equal(previewB.priceEffects[0].source, "SUBSEQUENT_PRICE_HISTORY_CURRENT");
      assert.equal(previewB.priceEffects[0].requiresPriceResolution, false);
      assert.equal((await request(`/purchases/${firstB.id}/reversals`, { method: "POST", body: {
        reason: "first input was duplicated", previewVersion: previewB.previewVersion, idempotencyKey: randomUUID(), priceResolutions: [],
      } })).status, 201);
      const masterBAfterReversal = await prisma.priceMaster.findUniqueOrThrow({ where: { id: masterB.id } });
      assert.equal(masterBAfterReversal.currentPriceHistoryId, masterBAfterLater.currentPriceHistoryId);
      assert.equal(masterBAfterReversal.version, masterBAfterLater.version);
      assert.equal(masterBAfterReversal.currentUnitPrice.toString(), "45");

      // C: unknown/legacy provenance stays unknown until an explicit correction price establishes a new source.
      const productC = await createProduct("c");
      const purchaseC = await createConfirmed(productC, `${fixture}-document-c`, "2.000000000", "70.000000");
      await post(purchaseC.id);
      const masterC = await prisma.priceMaster.findUniqueOrThrow({ where: { productId_supplierId: { productId: productC.id, supplierId: supplier.id } } });
      await prisma.priceMaster.update({ where: { id: masterC.id }, data: { currentPriceHistoryId: null, version: { increment: 1 } } });
      const legacyCurrentC = await prisma.priceMaster.findUniqueOrThrow({ where: { id: masterC.id } });
      const previewC = await (await request(`/purchases/${purchaseC.id}/reversal-preview`)).json();
      assert.equal(previewC.priceEffects[0].source, "LEGACY_UNKNOWN_CURRENT");
      assert.equal(previewC.priceEffects[0].requiresPriceResolution, true);
      assert.equal((await request(`/purchases/${purchaseC.id}/reversals`, { method: "POST", body: {
        reason: "legacy correction", previewVersion: previewC.previewVersion, idempotencyKey: randomUUID(),
        priceResolutions: [{ productId: productC.id, expectedPriceMasterVersion: legacyCurrentC.version, currentUnitPrice: "65.000000", currency: "JPY" }],
      } })).status, 201);
      const masterCAfter = await prisma.priceMaster.findUniqueOrThrow({ where: { id: masterC.id } });
      assert.equal(masterCAfter.version, legacyCurrentC.version + 1);
      assert.notEqual(masterCAfter.currentPriceHistoryId, null);

      // Auth, authorization, and CSRF are enforced before the domain operation.
      assert.equal((await request(`/purchases/${laterB.id}/reversal-preview`, { anonymous: true })).status, 401);
      assert.equal((await request(`/purchases/${laterB.id}/reversals`, { method: "POST", noCsrf: true, body: {
        reason: "no csrf", previewVersion: "0".repeat(64), idempotencyKey: randomUUID(), priceResolutions: [],
      } })).status, 403);
      const unprivileged = await prisma.user.create({ data: { email: `${fixture}-no-role@example.test`, displayName: "no role", passwordHash: "not-used" } });
      const unprivilegedToken = `${fixture}-unprivileged`;
      const unprivilegedCsrfToken = `${fixture}-unprivileged-csrf`;
      await prisma.identitySession.create({ data: {
        userId: unprivileged.id, tokenHash: hash(unprivilegedToken), csrfTokenHash: hash(unprivilegedCsrfToken),
        credentialVersion: unprivileged.credentialVersion, authenticationPolicyVersion: unprivileged.authenticationPolicyVersion,
        expiresAt: new Date(Date.now() + 60_000), activatedAt: new Date(),
      } });
      assert.equal((await fetch(`${baseUrl}/api/v1/purchases/${laterB.id}/reversal-preview`, {
        headers: { cookie: `lotus_session=${unprivilegedToken}`, "x-forwarded-for": "127.0.0.250" },
      })).status, 403);
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
