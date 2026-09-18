const assert = require("node:assert/strict");

const TEST_MODE_ENV = "LOTUS_REAL_DB_TEST_MODE";
const TEST_USER = "lotus_test";

function readDisposableDatabaseUrl(environmentVariable) {
  const value = process.env[environmentVariable];
  if (value === undefined) return undefined;
  assertDisposableDatabaseUrl(value, environmentVariable);
  return value;
}

function assertDisposableDatabaseUrl(value, label = "database URL") {
  assert.equal(process.env[TEST_MODE_ENV], "1", `${TEST_MODE_ENV}=1 is required before a disposable database test can start.`);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    assert.fail(`${label} must be a valid PostgreSQL URL.`);
  }

  assert.equal(parsed.protocol, "postgresql:", `${label} must use postgresql://.`);
  assert.equal(parsed.username, TEST_USER, `${label} must use the dedicated ${TEST_USER} test role.`);
  assert.ok(parsed.pathname.startsWith("/lotus_brain_"), `${label} must target a lotus_brain_ disposable database.`);
  assert.ok(parsed.pathname.length > "/lotus_brain_".length, `${label} must include a disposable database name.`);
  assert.ok(parsed.searchParams.get("schema") === null || parsed.searchParams.get("schema") === "public", `${label} may use only the public schema.`);

  if (process.env.GITHUB_ACTIONS === "true") {
    assert.equal(parsed.hostname, "127.0.0.1", `${label} must target the mapped GitHub Actions postgres service.`);
    assert.equal(parsed.port || "5432", "5432", `${label} must target port 5432 in GitHub Actions.`);
    return;
  }

  assert.equal(parsed.hostname, "127.0.0.1", `${label} must target loopback 127.0.0.1 locally.`);
  const port = Number(parsed.port);
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && port !== 5432, `${label} must use a generated local test port, never 5432.`);
}

module.exports = { TEST_MODE_ENV, TEST_USER, assertDisposableDatabaseUrl, readDisposableDatabaseUrl };
