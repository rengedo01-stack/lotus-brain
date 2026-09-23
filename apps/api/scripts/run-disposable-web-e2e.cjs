const { randomBytes } = require("node:crypto");
const { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { assertDisposableDatabaseUrl, TEST_MODE_ENV, TEST_USER } = require("../test/support/disposable-database.cjs");

const DATABASE_NAME = "lotus_brain_pr006c24c2d_browser_e2e_test";
const repositoryRoot = path.resolve(__dirname, "../../..");
const apiDirectory = path.join(repositoryRoot, "apps", "api");
const composeFile = path.join(repositoryRoot, "compose.test.yaml");
const artifactDirectory = path.join(repositoryRoot, ".artifacts", "browser-e2e");
const stateDirectory = path.join(tmpdir(), `lotus-brain-browser-e2e-state-${randomBytes(10).toString("hex")}`);
const safeEnvironment = { ...process.env };
delete safeEnvironment.DATABASE_URL;
process.env[TEST_MODE_ENV] = "1";

let composeEnvironment;
let composeArguments;
let apiProcess;
let webProcess;
let succeeded = false;
let cleaning = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function freeLoopbackPort() {
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
  for (const resource of [
    { arguments: ["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], name: "containers" },
    { arguments: ["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`], name: "volumes" },
  ]) {
    const result = spawnSync("docker", resource.arguments, { encoding: "utf8" });
    if (result.error !== undefined || result.status !== 0) throw new Error(`Unable to verify disposable Docker ${resource.name} cleanup.`);
    if (result.stdout.trim() !== "") throw new Error(`Disposable Docker ${resource.name} remain after browser E2E cleanup.`);
  }
}

function redactLogFile(filename) {
  if (!existsSync(filename)) return;
  const sanitized = readFileSync(filename, "utf8")
    .replace(/((?:authorization|cookie|set-cookie|x-csrf-token|csrfToken|password|sessionToken|preAuthToken)[^:=\s]*\s*[:=]\s*)(?:"[^"]*"|\S+)/gi, "$1[REDACTED]")
    .replace(/(lotus_session=)[^;\s"]+/gi, "$1[REDACTED]");
  writeFileSync(filename, sanitized, { mode: 0o600 });
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  });
}

function redactTraceText(filename) {
  const contents = readFileSync(filename, "utf8")
    .replace(/(lotus_session=)[^;\s"\\]+/gi, "$1[REDACTED]")
    .replace(/("name"\s*:\s*"(?:authorization|cookie|set-cookie|x-csrf-token)"\s*,\s*"value"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"")
    .replace(/("(?:csrfToken|password|sessionToken|preAuthToken)"\s*:\s*)"[^"]*"/gi, "$1\"[REDACTED]\"");
  writeFileSync(filename, contents, { mode: 0o600 });
}

function traceContainsSecret(directory) {
  return filesUnder(directory).filter((filename) => /\.(?:trace|json|html|stacks)$/.test(filename)).some((filename) => {
    const contents = readFileSync(filename, "utf8");
    return /lotus_session=(?!\[REDACTED\])/i.test(contents)
      || /"name"\s*:\s*"(?:cookie|set-cookie|authorization|x-csrf-token)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\])/i.test(contents)
      || /"(?:csrfToken|password|sessionToken|preAuthToken)"\s*:\s*"(?!\[REDACTED\])/i.test(contents)
      || /C24C2D browser fixture password/.test(contents);
  });
}

function sanitizeFailureTraces() {
  for (const archive of filesUnder(path.join(artifactDirectory, "playwright")).filter((filename) => path.basename(filename) === "trace.zip")) {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "lotus-brain-browser-e2e-trace-"));
    try {
      const extract = spawnSync("unzip", ["-qq", archive, "-d", temporaryDirectory]);
      if (extract.error !== undefined || extract.status !== 0) throw new Error("Unable to extract the Playwright trace for redaction.");
      rmSync(path.join(temporaryDirectory, "src"), { recursive: true, force: true });
      rmSync(path.join(temporaryDirectory, "attachments"), { recursive: true, force: true });
      for (const networkFile of filesUnder(temporaryDirectory).filter((filename) => filename.endsWith(".network"))) {
        rmSync(networkFile, { force: true });
      }
      for (const traceFile of filesUnder(temporaryDirectory).filter((filename) => /\.(?:trace|json|html|stacks)$/.test(filename))) {
        redactTraceText(traceFile);
      }
      if (traceContainsSecret(temporaryDirectory)) throw new Error("Playwright trace still contains a credential after redaction.");
      rmSync(archive, { force: true });
      const repack = spawnSync("zip", ["-q", "-r", archive, "."], { cwd: temporaryDirectory });
      if (repack.error !== undefined || repack.status !== 0) throw new Error("Unable to repack the redacted Playwright trace.");
    } catch (error) {
      rmSync(archive, { force: true });
      console.error(error instanceof Error ? `${error.message} The unsafe trace was removed.` : "The unsafe Playwright trace was removed.");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function startServer(command, arguments, environment, logName) {
  const logFile = path.join(artifactDirectory, logName);
  const descriptor = openSync(logFile, "a", 0o600);
  const child = spawn(command, arguments, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", descriptor, descriptor],
  });
  closeSync(descriptor);
  child.once("error", () => {});
  return { child, logFile };
}

async function waitForHttp(url, name, child, logFile) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited before becoming ready. See ${logFile}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status === 401) return;
    } catch {
      // Startup is still in progress. The deadline bounds this deterministic readiness poll.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} did not become ready within 60 seconds. See ${logFile}.`);
}

async function stopServer(server) {
  if (server === undefined || server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.child.kill("SIGTERM");
  const timeout = new Promise((resolve) => setTimeout(resolve, 10_000, "timeout"));
  if (await Promise.race([exited, timeout]) === "timeout" && server.child.exitCode === null) {
    server.child.kill("SIGKILL");
    await exited;
  }
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  try {
    await stopServer(webProcess);
    await stopServer(apiProcess);
  } finally {
    sanitizeFailureTraces();
    redactLogFile(path.join(artifactDirectory, "api.log"));
    redactLogFile(path.join(artifactDirectory, "web.log"));
    if (composeArguments !== undefined && composeEnvironment !== undefined) {
      try {
        run("docker", [...composeArguments, "down", "--volumes", "--remove-orphans"], { env: composeEnvironment });
      } finally {
        const projectName = composeArguments[2];
        assertNoDockerResources(projectName);
      }
    }
    rmSync(stateDirectory, { recursive: true, force: true });
    if (succeeded) rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

function terminate(signal) {
  void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 1));
}

process.once("SIGINT", () => terminate("SIGINT"));
process.once("SIGTERM", () => terminate("SIGTERM"));

async function main() {
  try {
    run("docker", ["info", "--format", "{{.ServerVersion}}"], { env: safeEnvironment });
  } catch {
    throw new Error("Docker Desktop is required for browser E2E tests and is not running. Start it explicitly, then retry.");
  }

  const [postgresPort, apiPort, webPort] = await Promise.all([freeLoopbackPort(), freeLoopbackPort(), freeLoopbackPort()]);
  if (postgresPort === 5432) throw new Error("Refusing to use the development PostgreSQL port.");
  const password = randomBytes(24).toString("base64url");
  const databaseUrl = new URL(`postgresql://${TEST_USER}:${password}@127.0.0.1:${postgresPort}/${DATABASE_NAME}`);
  databaseUrl.searchParams.set("schema", "public");
  assertDisposableDatabaseUrl(databaseUrl.toString(), "generated browser E2E database URL", { allowGeneratedPortInGitHubActions: true });

  const projectName = `lotus-brain-browser-e2e-${randomBytes(8).toString("hex")}`;
  composeArguments = ["compose", "--project-name", projectName, "--file", composeFile];
  composeEnvironment = {
    ...safeEnvironment,
    LOTUS_TEST_POSTGRES_DB: DATABASE_NAME,
    LOTUS_TEST_POSTGRES_PASSWORD: password,
    LOTUS_TEST_POSTGRES_PORT: String(postgresPort),
  };
  const webBaseUrl = `http://localhost:${webPort}`;
  const apiBaseUrl = `http://localhost:${apiPort}/api/v1`;
  const databaseEnvironment = {
    ...safeEnvironment,
    [TEST_MODE_ENV]: "1",
    DATABASE_URL: databaseUrl.toString(),
  };
  const apiEnvironment = {
    ...databaseEnvironment,
    NODE_ENV: "test",
    PORT: String(apiPort),
    CORS_ORIGIN: webBaseUrl,
    PUBLIC_WEB_BASE_URL: webBaseUrl,
    WEBAUTHN_ORIGIN: webBaseUrl,
    WEBAUTHN_RP_ID: "localhost",
    WEBAUTHN_RP_NAME: "Lotus BRAIN browser E2E",
    LOG_LEVEL: "error",
    CSRF_LEGACY_SCALAR_FALLBACK: "false",
  };
  const webEnvironment = {
    ...safeEnvironment,
    NODE_ENV: "production",
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
  };

  rmSync(artifactDirectory, { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });

  run("pnpm", ["--filter", "@lotus-brain/api", "build"], { env: safeEnvironment });
  run("docker", [...composeArguments, "up", "--detach", "--wait"], { env: composeEnvironment });
  run("pnpm", ["--dir", "apps/api", "exec", "prisma", "migrate", "deploy", "--config", "./prisma.config.ts"], { env: databaseEnvironment });
  run("pnpm", ["--dir", "apps/api", "exec", "prisma", "migrate", "status", "--config", "./prisma.config.ts"], { env: databaseEnvironment });
  run("pnpm", ["--filter", "@lotus-brain/web", "build"], { env: webEnvironment });

  apiProcess = startServer(process.execPath, [path.join(apiDirectory, "dist", "main.js")], apiEnvironment, "api.log");
  await waitForHttp(`${apiBaseUrl}/health`, "API", apiProcess.child, apiProcess.logFile);
  webProcess = startServer("pnpm", ["--dir", "apps/web", "exec", "next", "start", "--hostname", "localhost", "--port", String(webPort)], webEnvironment, "web.log");
  await waitForHttp(`${webBaseUrl}/login`, "Web", webProcess.child, webProcess.logFile);

  run("pnpm", ["exec", "playwright", "test", "--config", "playwright.config.ts"], {
    env: {
      ...safeEnvironment,
      [TEST_MODE_ENV]: "1",
      LOTUS_WEB_E2E_BASE_URL: webBaseUrl,
      LOTUS_WEB_E2E_DATABASE_URL: databaseUrl.toString(),
      LOTUS_WEB_E2E_ARTIFACT_DIR: artifactDirectory,
      LOTUS_WEB_E2E_STATE_DIR: stateDirectory,
    },
  });
  succeeded = true;
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
