const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const databaseUrl = process.env.SESSION_TERMINATION_DATABASE_URL;

if (databaseUrl === undefined) {
  test("session termination real database proof is opt-in", { skip: "SESSION_TERMINATION_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const allowedDatabaseNames = new Set([
    "lotus_brain_pr005q_test",
    "lotus_brain_pr005w1_termination_test",
  ]);
  if (!allowedDatabaseNames.has(databaseName)) {
    test("session termination real database proof requires an explicitly disposable database", () => {
      assert.fail("SESSION_TERMINATION_DATABASE_URL must target an approved disposable session-termination database.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("logout HTTP proof revokes only an activated session, preserves CSRF failure semantics, and rejects pending sessions", async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.NODE_ENV = "test";
      process.env.CORS_ORIGIN = "http://localhost:3000";
      process.env.PUBLIC_WEB_BASE_URL = "http://localhost:3000";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
      process.env.LOG_LEVEL = "error";

      const { AppModule } = require("../dist/app.module.js");
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr005q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let app;

      async function createUser(label) {
        return prisma.user.create({
          data: {
            email: `${fixture}-${label}@example.test`,
            displayName: `PR-005Q ${label}`,
            passwordHash: "not-used-by-session-termination-proof",
          },
        });
      }

      async function createSession(user, label, activatedAt) {
        const token = `${fixture}-${label}-token`;
        const csrfToken = `${fixture}-${label}-csrf`;
        await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hash(token),
            csrfTokenHash: hash(csrfToken),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 120_000),
            activatedAt,
          },
        });
        return { csrfToken, token };
      }

      async function startApp() {
        app = await NestFactory.create(AppModule, { logger: false });
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        return `http://127.0.0.1:${address.port}`;
      }

      try {
        const user = await createUser("active");
        const activeSession = await createSession(user, "active", new Date());
        const pendingSession = await createSession(user, "pending", null);
        const baseUrl = await startApp();

        function request(path, session, options = {}) {
          const method = options.method ?? "GET";
          return fetch(`${baseUrl}/api/v1${path}`, {
            method,
            headers: {
              cookie: `lotus_session=${session.token}`,
              ...(method === "GET" || options.csrf === false ? {} : { "x-csrf-token": session.csrfToken }),
            },
          });
        }

        assert.equal((await request("/auth/me", activeSession)).status, 200);

        const csrfResponse = await request("/auth/csrf", activeSession);
        assert.equal(csrfResponse.status, 200);
        const { csrfToken } = await csrfResponse.json();
        assert.equal(typeof csrfToken, "string");
        activeSession.csrfToken = csrfToken;

        const csrfFailure = await request("/auth/logout", activeSession, { method: "POST", csrf: false });
        assert.equal(csrfFailure.status, 403);
        assert.equal(await prisma.identitySession.count({ where: { tokenHash: hash(activeSession.token), revokedAt: null } }), 1);

        const logoutResponse = await request("/auth/logout", activeSession, { method: "POST" });
        assert.equal(logoutResponse.status, 200);
        assert.deepEqual(await logoutResponse.json(), { status: "ok" });
        assert.equal(logoutResponse.headers.get("cache-control"), "no-store");
        assert.match(logoutResponse.headers.get("set-cookie") ?? "", /lotus_session=;/);
        assert.equal(await prisma.identitySession.count({ where: { tokenHash: hash(activeSession.token), revokedAt: null } }), 0);
        assert.equal((await request("/auth/me", activeSession)).status, 401);

        assert.equal((await request("/auth/logout", pendingSession, { method: "POST" })).status, 401);
        assert.equal(await prisma.identitySession.count({ where: { tokenHash: hash(pendingSession.token), revokedAt: null } }), 1);
      } finally {
        await app?.close();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanupClient = new Client({ connectionString: cleanupUrl.toString() });
        await cleanupClient.connect();
        try {
          await cleanupClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE);`);
        } finally {
          await cleanupClient.end();
        }
      }
    });
  }
}
