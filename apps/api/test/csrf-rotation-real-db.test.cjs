const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const databaseUrl = process.env.CSRF_ROTATION_DATABASE_URL;

if (databaseUrl === undefined) {
  test("CSRF rotation real database proof is opt-in", { skip: "CSRF_ROTATION_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== "lotus_brain_pr005s_test") {
    test("CSRF rotation real database proof requires the disposable PR-005S database", () => {
      assert.fail("CSRF_ROTATION_DATABASE_URL must target lotus_brain_pr005s_test.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("CSRF HTTP proof rotates tokens, rejects superseded proofs, and rejects revoked sessions", async () => {
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
      const fixture = `pr005s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let app;

      async function createSession(label) {
        const user = await prisma.user.create({
          data: {
            email: `${fixture}-${label}@example.test`,
            displayName: `PR-005S ${label}`,
            passwordHash: "not-used-by-csrf-rotation-proof",
          },
        });
        const token = `${fixture}-${label}-session`;
        await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hash(token),
            csrfTokenHash: hash(`${fixture}-${label}-initial-csrf`),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 120_000),
            activatedAt: new Date(),
          },
        });
        return { token };
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
        const baseUrl = await startApp();
        const activeSession = await createSession("active");

        function request(path, session, options = {}) {
          return fetch(`${baseUrl}/api/v1${path}`, {
            method: options.method ?? "GET",
            headers: {
              cookie: `lotus_session=${session.token}`,
              ...(options.csrfToken === undefined ? {} : { "x-csrf-token": options.csrfToken }),
            },
          });
        }

        const firstCsrfResponse = await request("/auth/csrf", activeSession);
        assert.equal(firstCsrfResponse.status, 200);
        assert.equal(firstCsrfResponse.headers.get("cache-control"), "no-store");
        const firstCsrf = await firstCsrfResponse.json();
        assert.deepEqual(Object.keys(firstCsrf), ["csrfToken"]);
        assert.equal(typeof firstCsrf.csrfToken, "string");
        assert.ok(firstCsrf.csrfToken.length > 0);

        const secondCsrfResponse = await request("/auth/csrf", activeSession);
        assert.equal(secondCsrfResponse.status, 200);
        const secondCsrf = await secondCsrfResponse.json();
        assert.deepEqual(Object.keys(secondCsrf), ["csrfToken"]);
        assert.equal(typeof secondCsrf.csrfToken, "string");
        assert.ok(secondCsrf.csrfToken.length > 0);
        assert.notEqual(secondCsrf.csrfToken, firstCsrf.csrfToken);

        assert.equal((await request("/auth/logout", activeSession, { method: "POST", csrfToken: firstCsrf.csrfToken })).status, 403);
        const currentTokenLogout = await request("/auth/logout", activeSession, { method: "POST", csrfToken: secondCsrf.csrfToken });
        assert.equal(currentTokenLogout.status, 200);
        assert.deepEqual(await currentTokenLogout.json(), { status: "ok" });

        const revokedSession = await createSession("revoked");
        await prisma.identitySession.update({
          where: { tokenHash: hash(revokedSession.token) },
          data: { revokedAt: new Date() },
        });
        assert.equal((await request("/auth/csrf", revokedSession)).status, 401);
        assert.equal((await request("/auth/logout", revokedSession, { method: "POST", csrfToken: "not-used" })).status, 401);
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
