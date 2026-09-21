const { Client } = require("pg");
const { assertDisposableDatabaseUrl, TEST_MODE_ENV } = require("../test/support/disposable-database.cjs");

const databaseUrl = process.env.LOTUS_TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("LOTUS_TEST_DATABASE_URL is required for the legacy price fixture.");
assertDisposableDatabaseUrl(databaseUrl, "LOTUS_TEST_DATABASE_URL");

const expectedDatabaseName = process.env.LOTUS_LEGACY_FIXTURE_DATABASE_NAME ?? "lotus_brain_pr006c24c1_price_provenance_test";
const eventType = process.env.LOTUS_LEGACY_FIXTURE_EVENT_TYPE;
if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== expectedDatabaseName) {
  throw new Error(`Legacy price fixture must target ${expectedDatabaseName}.`);
}
if (process.env[TEST_MODE_ENV] !== "1") throw new Error(`${TEST_MODE_ENV}=1 is required.`);

const legacy = {
  unitId: "legacy-price-provenance-unit",
  productId: "legacy-price-provenance-product",
  supplierId: "legacy-price-provenance-supplier",
  purchaseId: "legacy-price-provenance-purchase",
  purchaseItemId: "legacy-price-provenance-purchase-item",
  priceMasterId: "legacy-price-provenance-master",
  priceHistoryId: "legacy-price-provenance-history",
};

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      `INSERT INTO "Unit" ("id", "code", "name", "symbol", "dimension", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, 'COUNT'::"UnitDimension", 'ACTIVE'::"MasterStatus", CURRENT_TIMESTAMP)`,
      [legacy.unitId, "LEGACY-PRICE-UNIT", "Legacy price unit", "ea"],
    );
    await client.query(
      `INSERT INTO "Product" ("id", "code", "name", "baseUnitId", "inventoryUnitId", "status", "updatedAt")
       VALUES ($1, $2, $3, $4, $4, 'ACTIVE'::"MasterStatus", CURRENT_TIMESTAMP)`,
      [legacy.productId, "LEGACY-PRICE-PRODUCT", "Legacy price product", legacy.unitId],
    );
    await client.query(
      `INSERT INTO "Supplier" ("id", "code", "name", "status", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE'::"MasterStatus", CURRENT_TIMESTAMP)`,
      [legacy.supplierId, "LEGACY-PRICE-SUPPLIER", "Legacy price supplier"],
    );
    await client.query(
      `INSERT INTO "Purchase" (
        "id", "supplierId", "purchaseDate", "documentNumber", "status", "currency", "subtotal", "tax", "total", "updatedAt"
      ) VALUES (
        $1, $2, '2026-09-01T00:00:00.000Z', $3, 'DRAFT'::"PurchaseStatus", 'JPY', 7000, 0, 7000, CURRENT_TIMESTAMP
      )`,
      [legacy.purchaseId, legacy.supplierId, "LEGACY-PRICE-DOCUMENT"],
    );
    await client.query(
      `INSERT INTO "PurchaseItem" (
        "id", "purchaseId", "productId", "unitId", "lineNumber", "quantity", "unitPrice", "lineAmount", "taxRate", "updatedAt"
      ) VALUES ($1, $2, $3, $4, 1, 1, 7000, 7000, 0, CURRENT_TIMESTAMP)`,
      [legacy.purchaseItemId, legacy.purchaseId, legacy.productId, legacy.unitId],
    );
    await client.query(
      `INSERT INTO "PriceMaster" (
        "id", "productId", "supplierId", "currentUnitPrice", "currency", "currentPriceEffectiveAt", "status", "updatedAt"
      ) VALUES ($1, $2, $3, 7000, 'JPY', '2026-09-01T00:00:00.000Z', 'ACTIVE'::"MasterStatus", CURRENT_TIMESTAMP)`,
      [legacy.priceMasterId, legacy.productId, legacy.supplierId],
    );
    const priceHistoryColumns = eventType === undefined
      ? `"id", "priceMasterId", "sourcePurchaseItemId", "inventoryUnitId", "unitPrice", "currency", "effectiveAt", "note"`
      : `"id", "priceMasterId", "sourcePurchaseItemId", "inventoryUnitId", "unitPrice", "currency", "effectiveAt", "note", "eventType"`;
    const priceHistoryValues = eventType === undefined
      ? `$1, $2, $3, $4, 7000, 'JPY', '2026-09-01T00:00:00.000Z', 'C24C-1 legacy fixture'`
      : `$1, $2, $3, $4, 7000, 'JPY', '2026-09-01T00:00:00.000Z', 'C24C-1 legacy fixture', $5::"PriceHistoryEventType"`;
    await client.query(
      `INSERT INTO "PriceHistory" (${priceHistoryColumns}) VALUES (${priceHistoryValues})`,
      eventType === undefined
        ? [legacy.priceHistoryId, legacy.priceMasterId, legacy.purchaseItemId, legacy.unitId]
        : [legacy.priceHistoryId, legacy.priceMasterId, legacy.purchaseItemId, legacy.unitId, eventType],
    );
    await client.query("COMMIT");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
