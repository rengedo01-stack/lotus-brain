const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { assertDisposableDatabaseUrl, TEST_MODE_ENV, TEST_USER } = require("../test/support/disposable-database.cjs");
const { readTarget } = require("./disposable-db-targets.cjs");

const targetNames = process.argv.slice(2);
if (targetNames.length === 0) throw new Error("Usage: node scripts/run-disposable-postgres.cjs <target> [...target]");

const repositoryRoot = path.resolve(__dirname, "../../..");
const composeFile = path.join(repositoryRoot, "compose.test.yaml");
const safeEnvironment = { ...process.env };
delete safeEnvironment.DATABASE_URL;
process.env[TEST_MODE_ENV] = "1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function readFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      server.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

function assertNoDockerResources(projectName) {
  const resources = [
    { args: ["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], name: "containers" },
    { args: ["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], name: "volumes" },
  ];
  for (const resource of resources) {
    const inspection = spawnSync("docker", resource.args, { encoding: "utf8" });
    if (inspection.error !== undefined) throw inspection.error;
    if (inspection.status !== 0) throw new Error(`Unable to verify disposable Docker ${resource.name} cleanup.`);
    if (inspection.stdout.trim() !== "") throw new Error(`Disposable Docker ${resource.name} remain for ${projectName}.`);
  }
}

async function runTarget(targetName) {
  const target = readTarget(targetName);
  const nonce = randomBytes(8).toString("hex");
  const projectName = `lotus-brain-test-${nonce}`;
  const port = await readFreeLoopbackPort();
  if (port === 5432) throw new Error("Refusing to use the development PostgreSQL port.");
  const password = randomBytes(24).toString("base64url");
  const databaseUrl = new URL(`postgresql://${TEST_USER}:${password}@127.0.0.1:${port}/${target.databaseName}`);
  databaseUrl.searchParams.set("schema", "public");
  assertDisposableDatabaseUrl(databaseUrl.toString(), "generated disposable database URL");

  const composeEnvironment = {
    ...safeEnvironment,
    LOTUS_TEST_POSTGRES_DB: target.databaseName,
    LOTUS_TEST_POSTGRES_PASSWORD: password,
    LOTUS_TEST_POSTGRES_PORT: String(port),
  };
  const compose = ["compose", "--project-name", projectName, "--file", composeFile];

  try {
    run("pnpm", ["--filter", "@lotus-brain/api", "build"], { env: safeEnvironment });
    run("docker", [...compose, "up", "--detach", "--wait"], { env: composeEnvironment });
    run(process.execPath, ["apps/api/scripts/run-disposable-db-target.cjs", targetName, "--migrate"], {
      env: { ...composeEnvironment, [TEST_MODE_ENV]: "1", LOTUS_TEST_DATABASE_URL: databaseUrl.toString() },
    });
  } finally {
    run("docker", [...compose, "down", "--volumes", "--remove-orphans"], { env: composeEnvironment });
    assertNoDockerResources(projectName);
  }
}

try {
  run("docker", ["info", "--format", "{{.ServerVersion}}"], { env: safeEnvironment });
} catch {
  throw new Error("Docker Desktop is required for disposable database tests and is not running. Start it explicitly, then retry.");
}

(async () => {
  for (const targetName of targetNames) await runTarget(targetName);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
