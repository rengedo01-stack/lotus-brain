const test = require("node:test");
const assert = require("node:assert/strict");
const { assertDisposableDatabaseUrl } = require("./support/disposable-database.cjs");

const savedEnvironment = {
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
  LOTUS_REAL_DB_TEST_MODE: process.env.LOTUS_REAL_DB_TEST_MODE,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.after(restoreEnvironment);

test("disposable database guard accepts only an explicit loopback test endpoint", () => {
  delete process.env.GITHUB_ACTIONS;
  process.env.LOTUS_REAL_DB_TEST_MODE = "1";
  assert.doesNotThrow(() => assertDisposableDatabaseUrl("postgresql://lotus_test:local-only@127.0.0.1:55432/lotus_brain_safe_test?schema=public"));
});

test("disposable database guard rejects missing explicit test mode", () => {
  delete process.env.GITHUB_ACTIONS;
  delete process.env.LOTUS_REAL_DB_TEST_MODE;
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:local-only@127.0.0.1:55432/lotus_brain_safe_test?schema=public"), /LOTUS_REAL_DB_TEST_MODE/);
});

test("disposable database guard rejects development ports and non-loopback hosts", () => {
  delete process.env.GITHUB_ACTIONS;
  process.env.LOTUS_REAL_DB_TEST_MODE = "1";
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:local-only@127.0.0.1:5432/lotus_brain_safe_test?schema=public"), /generated local test port/);
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:local-only@localhost:55432/lotus_brain_safe_test?schema=public"), /127\.0\.0\.1/);
});

test("disposable database guard allows only the mapped GitHub Actions postgres service in CI", () => {
  process.env.GITHUB_ACTIONS = "true";
  process.env.LOTUS_REAL_DB_TEST_MODE = "1";
  assert.doesNotThrow(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@127.0.0.1:5432/lotus_brain_safe_test?schema=public"));
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@127.0.0.1:55432/lotus_brain_safe_test?schema=public"), /port 5432/);
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@postgres:5432/lotus_brain_safe_test?schema=public"), /mapped GitHub Actions postgres service/);
  const browserE2EOptions = { allowGeneratedPortInGitHubActions: true };
  assert.doesNotThrow(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@127.0.0.1:55432/lotus_brain_safe_test?schema=public", "browser E2E database URL", browserE2EOptions));
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@127.0.0.1:5432/lotus_brain_safe_test?schema=public", "browser E2E database URL", browserE2EOptions), /generated non-5432 port/);
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@postgres:55432/lotus_brain_safe_test?schema=public", "browser E2E database URL", browserE2EOptions), /mapped GitHub Actions postgres service/);
  assert.throws(() => assertDisposableDatabaseUrl("postgresql://lotus_test:ci-only@127.0.0.1/lotus_brain_safe_test?schema=public", "browser E2E database URL", browserE2EOptions), /generated non-5432 port/);
});
