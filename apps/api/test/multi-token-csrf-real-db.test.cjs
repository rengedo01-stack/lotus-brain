const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");

const databaseUrl = process.env.MULTI_TOKEN_CSRF_DATABASE_URL;

if (databaseUrl === undefined) {
  test("multi-token CSRF PostgreSQL proof is opt-in", { skip: "MULTI_TOKEN_CSRF_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== "lotus_brain_pr005w1_test") {
    test("multi-token CSRF PostgreSQL proof requires the disposable PR-005W1 database", () => {
      assert.fail("MULTI_TOKEN_CSRF_DATABASE_URL must target lotus_brain_pr005w1_test.");
    });
  } else {
    const argon2 = require("argon2");
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaAuthRepository } = require("../dist/modules/auth/infrastructure/prisma-auth.repository.js");
    const { hashSecret, makeOpaqueToken } = require("../dist/modules/auth/auth.utils.js");

    test("multi-token CSRF stays bounded at eight, validates same-session tokens, and cannot outlive revocation", async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.NODE_ENV = "test";
      process.env.CORS_ORIGIN = "http://localhost:3000";
      process.env.PUBLIC_WEB_BASE_URL = "http://localhost:3000";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
      process.env.LOG_LEVEL = "error";
      process.env.CSRF_LEGACY_SCALAR_FALLBACK = "false";

      const { AppModule } = require("../dist/app.module.js");
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const auth = new PrismaAuthRepository(prisma);
      const fixture = `pr005w1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let app;
      let userId;

      async function createActiveSession(label) {
        const user = await prisma.user.create({
          data: {
            email: `${fixture}-${label}@example.test`,
            displayName: `PR-005W1 ${label}`,
            passwordHash: await argon2.hash("pr005w1 disposable password is sufficiently long", { type: argon2.argon2id }),
          },
        });
        const rawSessionToken = makeOpaqueToken();
        const rawLegacyCsrfToken = makeOpaqueToken();
        const session = await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hashSecret(rawSessionToken),
            csrfTokenHash: hashSecret(rawLegacyCsrfToken),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 5 * 60_000),
            activatedAt: new Date(),
          },
        });
        return { rawLegacyCsrfToken, rawSessionToken, session, user };
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
        const primary = await createActiveSession("primary");
        userId = primary.user.id;
        const baseUrl = await startApp();
        const request = (path, options = {}) => fetch(`${baseUrl}/api/v1${path}`, {
          method: options.method ?? "GET",
          headers: {
            cookie: `lotus_session=${primary.rawSessionToken}`,
            ...(options.csrfToken === undefined ? {} : { "x-csrf-token": options.csrfToken }),
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });

        // A pre-migration scalar is accepted only while an operator explicitly
        // enables the rolling-deployment fallback. The default is table-only.
        assert.equal(await auth.isSessionCsrfTokenValid({
          sessionId: primary.session.id,
          csrfTokenHash: hashSecret(primary.rawLegacyCsrfToken),
          allowLegacyScalarFallback: false,
        }), false);
        assert.equal(await auth.isSessionCsrfTokenValid({
          sessionId: primary.session.id,
          csrfTokenHash: hashSecret(primary.rawLegacyCsrfToken),
          allowLegacyScalarFallback: true,
        }), true);

        const csrfResponse = await request("/auth/csrf");
        assert.equal(csrfResponse.status, 200);
        assert.equal(csrfResponse.headers.get("cache-control"), "no-store");
        const csrfBody = await csrfResponse.json();
        assert.deepEqual(Object.keys(csrfBody), ["csrfToken"]);

        const sequential = [csrfBody.csrfToken];
        for (let index = 0; index < 8; index += 1) {
          const csrfToken = makeOpaqueToken();
          assert.notEqual(await auth.issueSessionCsrfToken({
            sessionId: primary.session.id,
            csrfTokenHash: hashSecret(csrfToken),
            mirrorLegacyScalar: false,
          }), null);
          sequential.push(csrfToken);
        }
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: primary.session.id } }), 8);
        const retained = await prisma.identityCsrfToken.findMany({
          where: { identitySessionId: primary.session.id },
          select: { tokenHash: true },
        });
        const retainedHashes = new Set(retained.map((token) => token.tokenHash));
        assert.equal(retainedHashes.has(hashSecret(sequential[0])), false);
        assert.deepEqual(
          sequential.slice(1).map(hashSecret).every((tokenHash) => retainedHashes.has(tokenHash)),
          true,
        );
        assert.equal(await auth.isSessionCsrfTokenValid({
          sessionId: primary.session.id,
          csrfTokenHash: hashSecret(sequential[0]),
          allowLegacyScalarFallback: false,
        }), false);
        assert.equal((await Promise.all(sequential.slice(1).map((csrfToken) => auth.isSessionCsrfTokenValid({
          sessionId: primary.session.id,
          csrfTokenHash: hashSecret(csrfToken),
          allowLegacyScalarFallback: false,
        })))).every(Boolean), true);

        const passwordChangePayload = {
          currentPassword: "not the current disposable password",
          newPassword: "a different password sufficiently long",
        };
        assert.equal((await request("/auth/password/change", {
          method: "POST",
          csrfToken: sequential[0],
          body: passwordChangePayload,
        })).status, 403);
        for (const csrfToken of sequential.slice(1)) {
          const response = await request("/auth/password/change", {
            method: "POST",
            csrfToken,
            body: passwordChangePayload,
          });
          assert.notEqual(response.status, 403);
        }

        const concurrent = Array.from({ length: 16 }, () => makeOpaqueToken());
        const concurrentResults = await Promise.all(
          concurrent.map((csrfToken) => auth.issueSessionCsrfToken({
            sessionId: primary.session.id,
            csrfTokenHash: hashSecret(csrfToken),
            mirrorLegacyScalar: false,
          })),
        );
        assert.equal(concurrentResults.every((result) => result !== null), true);
        assert.equal(new Set(concurrent).size, concurrent.length);
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: primary.session.id } }), 8);

        const race = await Promise.allSettled([
          request("/auth/csrf"),
          auth.revokeSession(primary.session.id),
        ]);
        assert.equal(race.filter((result) => result.status === "rejected").length, 0);
        const revoked = await prisma.identitySession.findUniqueOrThrow({ where: { id: primary.session.id } });
        assert.notEqual(revoked.revokedAt, null);
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: primary.session.id } }), 0);
        assert.equal((await request("/auth/me")).status, 401);

        // Pending activation keeps its login proof in IdentitySession only;
        // activation atomically creates the first active-session table token.
        const pendingUser = await prisma.user.create({
          data: {
            email: `${fixture}-pending@example.test`,
            displayName: "PR-005W1 pending",
            passwordHash: await argon2.hash("pr005w1 pending password is sufficiently long", { type: argon2.argon2id }),
          },
        });
        const pendingRawSession = makeOpaqueToken();
        const pendingRawProof = makeOpaqueToken();
        const pending = await auth.createPendingSession({
          userId: pendingUser.id,
          credentialVersion: pendingUser.credentialVersion,
          authenticationPolicyVersion: pendingUser.authenticationPolicyVersion,
          tokenHash: hashSecret(pendingRawSession),
          csrfTokenHash: hashSecret(pendingRawProof),
          expiresAt: new Date(Date.now() + 60_000),
        });
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: pending.id } }), 0);
        assert.equal(await auth.isSessionCsrfTokenValid({
          sessionId: pending.id,
          csrfTokenHash: hashSecret(pendingRawProof),
          allowLegacyScalarFallback: true,
        }), false);
        assert.equal(await auth.activateSession({
          tokenHash: hashSecret(pendingRawSession),
          csrfTokenHash: hashSecret(pendingRawProof),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        }), "ACTIVATED");
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: pending.id } }), 1);
        assert.equal(await auth.isSessionCsrfTokenValid({
          sessionId: pending.id,
          csrfTokenHash: hashSecret(pendingRawProof),
          allowLegacyScalarFallback: false,
        }), true);

        const passwordUser = await prisma.user.create({
          data: {
            email: `${fixture}-password-change@example.test`,
            displayName: "PR-005W1 password change",
            passwordHash: await argon2.hash("pr005w1 old password is sufficiently long", { type: argon2.argon2id }),
          },
        });
        const passwordSessionToken = makeOpaqueToken();
        const passwordCsrfToken = makeOpaqueToken();
        const passwordSession = await prisma.identitySession.create({
          data: {
            userId: passwordUser.id,
            tokenHash: hashSecret(passwordSessionToken),
            csrfTokenHash: hashSecret(passwordCsrfToken),
            credentialVersion: passwordUser.credentialVersion,
            authenticationPolicyVersion: passwordUser.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 60_000),
            activatedAt: new Date(),
          },
        });
        await auth.issueSessionCsrfToken({
          sessionId: passwordSession.id,
          csrfTokenHash: hashSecret(makeOpaqueToken()),
          mirrorLegacyScalar: false,
        });
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: passwordSession.id } }), 1);
        await auth.changePassword({
          userId: passwordUser.id,
          expectedCredentialVersion: passwordUser.credentialVersion,
          passwordHash: await argon2.hash("pr005w1 replacement password is sufficiently long", { type: argon2.argon2id }),
        });
        assert.ok((await prisma.identitySession.findUniqueOrThrow({ where: { id: passwordSession.id } })).revokedAt);
        assert.equal(await prisma.identityCsrfToken.count({ where: { identitySessionId: passwordSession.id } }), 0);
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
