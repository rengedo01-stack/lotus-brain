const targets = {
  "purchase-posting": {
    databaseName: "lotus_brain_pr005x_purchase_posting_test",
    environmentVariable: "PURCHASE_POSTING_DATABASE_URL",
    testFile: "test/purchase-posting-real-db.test.cjs",
  },
  "purchase-cancellation": {
    databaseName: "lotus_brain_pr006c24_purchase_cancellation_test",
    environmentVariable: "PURCHASE_CANCELLATION_DATABASE_URL",
    testFile: "test/purchase-cancellation-real-db.test.cjs",
  },
  "production-lifecycle": {
    databaseName: "lotus_brain_pr005e1",
    environmentVariable: "PRODUCTION_LIFECYCLE_DATABASE_URL",
    testFile: "test/production-lifecycle-real-db.test.cjs",
  },
  "stocktake-posting": {
    databaseName: "lotus_brain_pr005y_stocktake_posting_test",
    environmentVariable: "STOCKTAKE_POSTING_DATABASE_URL",
    testFile: "test/stocktake-posting-http-real-db.test.cjs",
  },
  "price-provenance-migration-compatibility": {
    databaseName: "lotus_brain_pr006c24c1_price_provenance_test",
    environmentVariable: "PRICE_PROVENANCE_MIGRATION_COMPATIBILITY_DATABASE_URL",
    testFile: "test/price-provenance-migration-compatibility-real-db.test.cjs",
    // This proof deploys the exact pre-C24C-1 migration set, seeds a legacy
    // price pair, then deploys the forward migration under test.
    migrationCompatibility: {
      firstNewMigration: "20260919090000_add_price_master_provenance_foundation",
      legacyFixtureScript: "scripts/create-price-provenance-legacy-fixture.cjs",
    },
  },
};

function readTarget(name) {
  const target = targets[name];
  if (target === undefined) {
    throw new Error(`Unknown disposable database target: ${name}. Allowed targets: ${Object.keys(targets).join(", ")}.`);
  }
  return target;
}

module.exports = { readTarget, targets };
