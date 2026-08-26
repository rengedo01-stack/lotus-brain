const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const databaseUrl = process.env.IDENTITY_DATABASE_URL;

if (databaseUrl === undefined) {
  test("identity administration real database proof is opt-in", { skip: "IDENTITY_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_identity_test_[a-z0-9_]+$/.test(databaseName)) {
    test("identity administration real database proof requires an isolated database", () => {
      assert.fail("IDENTITY_DATABASE_URL must target lotus_brain_identity_test_<name>.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("identity PostgreSQL and HTTP proof preserves permissions, lifecycle invalidation, audit atomicity, system safety, and conflicts", async () => {
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
      const fixture = `pr005f2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let app;
      let baseUrl;

      async function createUser(label) {
        return prisma.user.create({
          data: {
            email: `${fixture}-${label}@example.test`,
            displayName: `${label} tester`,
            passwordHash: "not-used-by-real-db-proof",
          },
        });
      }

      async function createSession(user, label) {
        const token = `${fixture}-${label}-session`;
        const csrfToken = `${fixture}-${label}-csrf`;
        await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hash(token),
            csrfTokenHash: hash(csrfToken),
            credentialVersion: 1,
            authenticationPolicyVersion: 1,
            expiresAt: new Date(Date.now() + 120_000),
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
        baseUrl = `http://127.0.0.1:${address.port}`;
      }

      function request(session, path, options = {}) {
        const method = options.method ?? "GET";
        return fetch(`${baseUrl}/api/v1${path}`, {
          method,
          headers: {
            ...(session === null ? {} : { cookie: `lotus_session=${session.token}` }),
            ...(method === "GET" || options.csrf === false ? {} : { "x-csrf-token": session.csrfToken }),
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      }

      try {
        const [systemAdminRole, identityRead, identityManage] = await Promise.all([
          prisma.role.findUniqueOrThrow({ where: { code: "SYSTEM_ADMIN" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "identity.read" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "identity.manage" } }),
        ]);
        const [admin, reader, target, deletionTarget, systemAdminTarget, concurrentTarget, rollbackTarget] = await Promise.all([
          createUser("admin"),
          createUser("reader"),
          createUser("target"),
          createUser("deletion-target"),
          createUser("system-admin-target"),
          createUser("concurrent-target"),
          createUser("rollback-target"),
        ]);
        const readerRole = await prisma.role.create({
          data: { code: `IDENTITY_READER_${Date.now()}`, name: "Identity reader", isSystem: false, status: "ACTIVE" },
        });
        await prisma.rolePermission.create({ data: { roleId: readerRole.id, permissionId: identityRead.id } });
        await assert.rejects(
          () => prisma.rolePermission.create({ data: { roleId: readerRole.id, permissionId: identityManage.id } }),
          /SYSTEM_ADMIN-only permissions cannot be assigned/,
        );
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: systemAdminRole.id },
          { userId: reader.id, roleId: readerRole.id },
          { userId: systemAdminTarget.id, roleId: systemAdminRole.id },
        ] });
        const [adminSession, readerSession, targetSession, deletionTargetSession, systemAdminTargetSession] = await Promise.all([
          createSession(admin, "admin"),
          createSession(reader, "reader"),
          createSession(target, "target"),
          createSession(deletionTarget, "deletion-target"),
          createSession(systemAdminTarget, "system-admin-target"),
        ]);

        await startApp();
        assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
        assert.equal((await request(null, "/identity/users")).status, 401);

        const readerListResponse = await request(readerSession, "/identity/users?status=ACTIVE&deleted=false&limit=100&offset=0");
        assert.equal(readerListResponse.status, 200);
        const readerList = await readerListResponse.json();
        const readTarget = readerList.find((user) => user.id === target.id);
        assert.deepEqual(Object.keys(readTarget).sort(), ["createdAt", "deletedAt", "email", "id", "lastLoginAt", "status", "updatedAt"]);
        assert.equal((await request(readerSession, `/identity/users/${target.id}`)).status, 200);
        assert.equal((await request(readerSession, `/identity/users/${target.id}`, { method: "PATCH", body: { status: "DISABLED" } })).status, 403);
        assert.equal((await request(readerSession, "/auth/me")).status, 200);

        assert.equal((await request(adminSession, `/identity/users/${target.id}`, { method: "PATCH", csrf: false, body: { status: "DISABLED" } })).status, 403);
        const disabledResponse = await request(adminSession, `/identity/users/${target.id}`, { method: "PATCH", body: { status: "DISABLED" } });
        assert.equal(disabledResponse.status, 200);
        assert.equal((await disabledResponse.json()).status, "DISABLED");
        assert.equal((await request(targetSession, "/auth/me")).status, 401);
        const statusAudit = await prisma.identityAuditLog.findFirstOrThrow({
          where: { action: "UPDATE_USER_STATUS", actorUserId: admin.id, targetUserId: target.id },
        });
        assert.deepEqual(statusAudit.beforeState, { status: "ACTIVE", deletedAt: null });
        assert.deepEqual(statusAudit.afterState, { status: "DISABLED", deletedAt: null });

        const deletedResponse = await request(adminSession, `/identity/users/${deletionTarget.id}`, { method: "DELETE" });
        assert.equal(deletedResponse.status, 200);
        assert.equal(typeof (await deletedResponse.json()).deletedAt, "string");
        assert.equal((await request(deletionTargetSession, "/auth/me")).status, 401);
        const deletedList = await (await request(readerSession, "/identity/users?deleted=true&limit=100&offset=0")).json();
        assert.ok(deletedList.some((user) => user.id === deletionTarget.id));

        assert.equal((await request(adminSession, `/identity/users/${admin.id}`, { method: "PATCH", body: { status: "DISABLED" } })).status, 403);
        assert.equal((await request(adminSession, `/identity/users/${systemAdminTarget.id}`, { method: "DELETE" })).status, 403);
        assert.equal((await request(systemAdminTargetSession, "/auth/me")).status, 200);

        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: systemAdminRole.id, permissionId: identityManage.id } } });
        assert.equal((await request(adminSession, `/identity/users/${concurrentTarget.id}`, { method: "PATCH", body: { status: "DISABLED" } })).status, 403);
        assert.equal((await request(adminSession, "/auth/me")).status, 200);
        await prisma.rolePermission.create({ data: { roleId: systemAdminRole.id, permissionId: identityManage.id } });

        const concurrentDelete = await Promise.all([
          request(adminSession, `/identity/users/${concurrentTarget.id}`, { method: "DELETE" }),
          request(adminSession, `/identity/users/${concurrentTarget.id}`, { method: "DELETE" }),
        ]);
        assert.deepEqual((await Promise.all(concurrentDelete.map((response) => response.status))).sort(), [200, 409]);
        assert.equal(await prisma.identityAuditLog.count({ where: { action: "SOFT_DELETE_USER", targetUserId: concurrentTarget.id } }), 1);

        const functionName = `pr005f2_identity_audit_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."action" = 'SOFT_DELETE_USER'::"IdentityAuditAction" THEN RAISE EXCEPTION 'forced identity audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "IdentityAuditLog" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        try {
          assert.equal((await request(adminSession, `/identity/users/${rollbackTarget.id}`, { method: "DELETE" })).status, 500);
          assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: rollbackTarget.id } })).deletedAt, null);
          assert.equal(await prisma.identityAuditLog.count({ where: { targetUserId: rollbackTarget.id } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "IdentityAuditLog";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }
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
