const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const repositoryRoot = require("node:path").resolve(__dirname, "..");
const runId = randomBytes(10).toString("hex");
const label = `lotus-brain.production-smoke=${runId}`;
const networkName = `lotus-brain-production-smoke-network-${runId}`;
const volumeName = `lotus-brain-production-smoke-data-${runId}`;
const postgresName = `lotus-brain-production-smoke-postgres-${runId}`;
const apiName = `lotus-brain-production-smoke-api-${runId}`;
const workerName = `lotus-brain-production-smoke-worker-${runId}`;
const webName = `lotus-brain-production-smoke-web-${runId}`;
const migrationName = `lotus-brain-production-smoke-migrate-${runId}`;
const statusName = `lotus-brain-production-smoke-status-${runId}`;
const webImage = `lotus-brain-production-smoke-web:${runId}`;
const apiImage = `lotus-brain-production-smoke-api:${runId}`;
const databasePassword = randomBytes(24).toString("base64url");
const smtpPassword = randomBytes(24).toString("base64url");
const databaseUrl = `postgresql://lotus_smoke:${databasePassword}@postgres:5432/lotus_smoke?schema=public`;

const resources = [postgresName, apiName, workerName, webName, migrationName, statusName];
let cleaning = false;

function run(command, arguments, options = {}) {
  const result = spawnSync(command, arguments, { cwd: repositoryRoot, encoding: "utf8", ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} command failed with exit code ${result.status}.`);
  }
  return result.stdout.trim();
}

function runQuietly(command, arguments) {
  const result = spawnSync(command, arguments, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
}

function docker(arguments, options) {
  return run("docker", arguments, options);
}

function dockerQuietly(arguments) {
  return runQuietly("docker", arguments);
}

function poll(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(name, predicate, failureMessage, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await poll(100);
  }
  throw new Error(`${name} ${failureMessage}.`);
}

async function assertContainerStaysRunning(name, durationMs) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    if (!containerRunning(name)) {
      throw new Error(`${name} exited during its ${durationMs}ms stability window.`);
    }
    await poll(100);
  }
}

function containerRunning(name) {
  const result = dockerQuietly(["inspect", "--format", "{{.State.Running}}", name]);
  return result.status === 0 && result.stdout.trim() === "true";
}

function containerExitCode(name) {
  const result = dockerQuietly(["inspect", "--format", "{{.State.ExitCode}}", name]);
  if (result.status !== 0) throw new Error(`Unable to inspect ${name}.`);
  return Number(result.stdout.trim());
}

function publishedPort(name) {
  const output = docker(["port", name, "8080/tcp"]);
  const match = output.match(/127\.0\.0\.1:(\d+)/);
  if (match === null) throw new Error(`Unable to discover loopback port for ${name}.`);
  return Number(match[1]);
}

async function waitForHttp(url, name) {
  await waitFor(name, async () => {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok;
    } catch {
      return false;
    }
  }, `did not become ready at ${url}`);
}

function assertImagePlatform(image) {
  const platform = docker(["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image]);
  if (platform !== "linux/amd64") throw new Error(`${image} must target linux/amd64, received ${platform}.`);
}

function assertNonRoot(image) {
  const user = docker(["image", "inspect", "--format", "{{.Config.User}}", image]);
  if (user.length === 0 || user === "root" || user === "0") throw new Error(`${image} must declare a non-root runtime user.`);
}

function assertNoBakedSecrets(image) {
  const history = docker(["history", "--no-trunc", image]);
  for (const secret of [databasePassword, smtpPassword]) {
    if (history.includes(secret)) throw new Error(`${image} history contains a generated smoke secret.`);
  }
}

function imageBuildArguments() {
  return ["build", "--platform=linux/amd64", "--progress=plain"];
}

function applicationEnvironment() {
  return [
    "--env", "NODE_ENV=production",
    "--env", "PORT=8080",
    "--env", `DATABASE_URL=${databaseUrl}`,
    "--env", "CORS_ORIGIN=https://brain.example.test",
    "--env", "PUBLIC_WEB_BASE_URL=https://brain.example.test",
    "--env", "WEBAUTHN_RP_NAME=Lotus BRAIN",
    "--env", "WEBAUTHN_RP_ID=brain.example.test",
    "--env", "WEBAUTHN_ORIGIN=https://brain.example.test",
    "--env", "SMTP_HOST=smtp.example.test",
    "--env", "SMTP_PORT=587",
    "--env", "SMTP_SECURE=false",
    "--env", "SMTP_USER=lotus-smoke@example.test",
    "--env", `SMTP_PASSWORD=${smtpPassword}`,
    "--env", "SMTP_FROM=Lotus BRAIN <no-reply@brain.example.test>",
  ];
}

function removeContainer(name) {
  const result = dockerQuietly(["rm", "--force", name]);
  if (result.status !== 0 && !/No such container/.test(result.stderr)) {
    throw new Error(`Unable to remove disposable container ${name}.`);
  }
}

function removeImage(name) {
  const result = dockerQuietly(["image", "rm", "--force", name]);
  if (result.status !== 0 && !/No such image/.test(result.stderr)) {
    throw new Error(`Unable to remove disposable image ${name}.`);
  }
}

function assertNoDockerResources() {
  const containers = docker(["ps", "--all", "--quiet", "--filter", `label=${label}`]);
  const networks = docker(["network", "ls", "--quiet", "--filter", `label=${label}`]);
  const volumes = docker(["volume", "ls", "--quiet", "--filter", `label=${label}`]);
  if (containers || networks || volumes) throw new Error("Disposable production-container smoke resources remain after cleanup.");
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  try {
    for (const resource of resources) removeContainer(resource);
    const network = dockerQuietly(["network", "rm", networkName]);
    if (network.status !== 0 && !/No such network/.test(network.stderr)) throw new Error("Unable to remove disposable Docker network.");
    const volume = dockerQuietly(["volume", "rm", "--force", volumeName]);
    if (volume.status !== 0 && !/No such volume/.test(volume.stderr)) throw new Error("Unable to remove disposable Docker volume.");
    assertNoDockerResources();
  } finally {
    removeImage(webImage);
    removeImage(apiImage);
  }
}

function terminate(signal) {
  void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 1));
}

process.once("SIGINT", () => terminate("SIGINT"));
process.once("SIGTERM", () => terminate("SIGTERM"));

async function main() {
  docker(["info", "--format", "{{.ServerVersion}}"]);

  docker([...imageBuildArguments(), "--file", "Dockerfile.web", "--build-arg", "NEXT_PUBLIC_API_BASE_URL=https://brain.example.test/api/v1", "--tag", webImage, "."]);
  docker([...imageBuildArguments(), "--file", "Dockerfile.api", "--tag", apiImage, "."]);
  assertImagePlatform(webImage);
  assertImagePlatform(apiImage);
  assertNonRoot(webImage);
  assertNonRoot(apiImage);
  assertNoBakedSecrets(webImage);
  assertNoBakedSecrets(apiImage);

  docker(["network", "create", "--label", label, networkName]);
  docker(["volume", "create", "--label", label, volumeName]);
  docker([
    "run", "--detach", "--name", postgresName, "--label", label,
    "--network", networkName, "--network-alias", "postgres",
    "--mount", `type=volume,source=${volumeName},target=/var/lib/postgresql/data`,
    "--env", "POSTGRES_DB=lotus_smoke",
    "--env", "POSTGRES_USER=lotus_smoke",
    "--env", `POSTGRES_PASSWORD=${databasePassword}`,
    "--platform=linux/amd64", "postgres:17-alpine",
  ]);
  await waitFor("PostgreSQL", () => dockerQuietly(["exec", postgresName, "pg_isready", "-U", "lotus_smoke", "-d", "lotus_smoke"]).status === 0, "did not become ready");

  docker([
    "run", "--name", migrationName, "--label", label, "--network", networkName,
    ...applicationEnvironment(), apiImage,
    "pnpm", "exec", "prisma", "migrate", "deploy", "--config", "./prisma.config.ts",
  ]);
  if (containerExitCode(migrationName) !== 0) throw new Error("Production image migration command exited unsuccessfully.");
  docker([
    "run", "--name", statusName, "--label", label, "--network", networkName,
    "--env", `DATABASE_URL=${databaseUrl}`, apiImage,
    "pnpm", "exec", "prisma", "migrate", "status", "--config", "./prisma.config.ts",
  ]);
  if (containerExitCode(statusName) !== 0) throw new Error("Production image migration status command exited unsuccessfully.");

  docker([
    "run", "--detach", "--name", apiName, "--label", label, "--network", networkName,
    "--publish", "127.0.0.1::8080", ...applicationEnvironment(), apiImage,
  ]);
  await waitForHttp(`http://127.0.0.1:${publishedPort(apiName)}/api/v1/health`, "API");

  docker([
    "run", "--detach", "--name", workerName, "--label", label, "--network", networkName,
    ...applicationEnvironment(), apiImage, "node", "dist/notification.worker.js",
  ]);
  await waitFor("Worker", () => containerRunning(workerName), "did not start");
  await assertContainerStaysRunning(workerName, 2_000);
  docker(["kill", "--signal=SIGTERM", workerName]);
  await waitFor("Worker", () => !containerRunning(workerName), "did not stop after SIGTERM", 10_000);
  if (containerExitCode(workerName) !== 0) throw new Error("Worker did not stop gracefully after SIGTERM.");

  docker([
    "run", "--detach", "--name", webName, "--label", label,
    "--publish", "127.0.0.1::8080",
    "--env", "PORT=8080", "--env", "HOSTNAME=0.0.0.0", webImage,
  ]);
  await waitForHttp(`http://127.0.0.1:${publishedPort(webName)}/login`, "Web");
}

main().then(
  () => cleanup(),
  async (error) => {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error(cleanupError instanceof Error ? cleanupError.message : cleanupError);
    }
    throw error;
  },
).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
