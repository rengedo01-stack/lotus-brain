const { spawnSync } = require("node:child_process");
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

if (option === "--migrate") {
  const migrationEnvironment = { ...childEnvironment, DATABASE_URL: databaseUrl };
  run("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "./prisma.config.ts"], migrationEnvironment);
  run("pnpm", ["exec", "prisma", "migrate", "status", "--config", "./prisma.config.ts"], migrationEnvironment);
}

run(process.execPath, ["--test", "--test-concurrency=1", target.testFile]);
