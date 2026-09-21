const { spawnSync } = require("node:child_process");
const { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { assertDisposableDatabaseUrl, TEST_MODE_ENV } = require("../test/support/disposable-database.cjs");
const { readTarget } = require("./disposable-db-targets.cjs");

const [targetName, option] = process.argv.slice(2);
if (targetName === undefined || (option !== undefined && option !== "--migrate")) {
  throw new Error("Usage: node scripts/run-disposable-db-target.cjs <target> [--migrate]");
}

const target = readTarget(targetName);
const databaseUrl = process.env.LOTUS_TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("LOTUS_TEST_DATABASE_URL is required.");

assertDisposableDatabaseUrl(databaseUrl, "LOTUS_TEST_DATABASE_URL");
const parsed = new URL(databaseUrl);
if (decodeURIComponent(parsed.pathname.slice(1)) !== target.databaseName) {
  throw new Error(`LOTUS_TEST_DATABASE_URL must target ${target.databaseName} for ${targetName}.`);
}

const apiDirectory = path.resolve(__dirname, "..");
const childEnvironment = { ...process.env, [TEST_MODE_ENV]: "1", [target.environmentVariable]: databaseUrl };
delete childEnvironment.DATABASE_URL;

function run(command, args, environment = childEnvironment) {
  const result = spawnSync(command, args, { cwd: apiDirectory, env: environment, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function createLegacyMigrationsDirectory(firstNewMigration) {
  const sourceDirectory = path.join(apiDirectory, "prisma", "migrations");
  const migrationNames = readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const firstNewIndex = migrationNames.indexOf(firstNewMigration);
  if (firstNewIndex < 1) {
    throw new Error(`Unable to locate a non-empty legacy migration set before ${firstNewMigration}.`);
  }

  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lotus-brain-price-provenance-legacy-"));
  const lockFile = path.join(sourceDirectory, "migration_lock.toml");
  if (existsSync(lockFile)) cpSync(lockFile, path.join(temporaryDirectory, "migration_lock.toml"));
  for (const migrationName of migrationNames.slice(0, firstNewIndex)) {
    cpSync(path.join(sourceDirectory, migrationName), path.join(temporaryDirectory, migrationName), { recursive: true });
  }
  return temporaryDirectory;
}

function runMigrations(environment) {
  run("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "./prisma.config.ts"], environment);
  run("pnpm", ["exec", "prisma", "migrate", "status", "--config", "./prisma.config.ts"], environment);
}

if (option === "--migrate") {
  const migrationEnvironment = { ...childEnvironment, DATABASE_URL: databaseUrl };
  const compatibility = target.migrationCompatibility;
  if (compatibility === undefined) {
    runMigrations(migrationEnvironment);
  } else {
    const legacyMigrationsDirectory = createLegacyMigrationsDirectory(compatibility.firstNewMigration);
    try {
      runMigrations({ ...migrationEnvironment, LOTUS_PRISMA_MIGRATIONS_PATH: legacyMigrationsDirectory });
      run(process.execPath, [compatibility.legacyFixtureScript], {
        ...migrationEnvironment,
        LOTUS_LEGACY_FIXTURE_DATABASE_NAME: target.databaseName,
        ...(compatibility.legacyFixtureEnvironment ?? {}),
      });
    } finally {
      rmSync(legacyMigrationsDirectory, { recursive: true, force: true });
    }
    runMigrations(migrationEnvironment);
  }
}

run(process.execPath, ["--test", "--test-concurrency=1", target.testFile]);
