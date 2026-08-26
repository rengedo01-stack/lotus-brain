const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const databaseUrl = process.env.AUTHORIZATION_DATABASE_URL;

if (databaseUrl === undefined) {
  test("authorization administration real database proof is opt-in", { skip: "AUTHORIZATION_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_authorization_test_[a-z0-9_]+$/.test(databaseName)) {
    test("authorization administration real database proof requires an isolated database", () => {
      assert.fail("AUTHORIZATION_DATABASE_URL must target lotus_brain_authorization_test_<name>.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    async function runAuthorizationAdministrationRealDatabaseProof() {
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
      const fixture = `pr005f1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        const [systemAdminRole, legacyRole, authorizationRead, authorizationManage, masterRead] = await Promise.all([
          prisma.role.findUniqueOrThrow({ where: { code: "SYSTEM_ADMIN" } }),
          prisma.role.findUniqueOrThrow({ where: { code: "LEGACY_AUTHENTICATED" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "authorization.read" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "authorization.manage" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "master.read" } }),
        ]);
        const admin = await createUser("admin");
        const reader = await createUser("reader");
        const target = await createUser("target");
        const readOnlyRole = await prisma.role.create({
          data: { code: `READ_ONLY_${Date.now()}`, name: "Authorization reader", isSystem: false, status: "ACTIVE" },
        });
        await prisma.rolePermission.create({ data: { roleId: readOnlyRole.id, permissionId: authorizationRead.id } });
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: systemAdminRole.id },
          { userId: reader.id, roleId: readOnlyRole.id },
        ] });
        const [adminSession, readerSession, targetSession] = await Promise.all([
          createSession(admin, "admin"),
          createSession(reader, "reader"),
          createSession(target, "target"),
        ]);

        await startApp();
        assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
        assert.equal((await request(null, "/authorization/roles")).status, 401);
        assert.equal((await request(readerSession, "/authorization/roles")).status, 200);
        assert.equal((await request(readerSession, "/authorization/roles", {
          method: "POST",
          body: { code: "READER_MUST_NOT_CREATE", name: "Denied" },
        })).status, 403);
        assert.equal((await request(adminSession, "/authorization/roles", { method: "POST", csrf: false, body: { code: "CSRF_CHECK", name: "CSRF" } })).status, 403);

        const catalogResponse = await request(adminSession, "/authorization/permissions");
        assert.equal(catalogResponse.status, 200);
        const catalog = await catalogResponse.json();
        assert.equal(catalog.find((permission) => permission.code === "authorization.manage").customRoleAssignable, false);
        const legacyPermissions = await prisma.rolePermission.findMany({
          where: { roleId: legacyRole.id },
          include: { permission: true },
        });
        assert.ok(legacyPermissions.some(({ permission }) => permission.code === "master.read"));
        assert.equal(legacyPermissions.some(({ permission }) => permission.code.startsWith("authorization.") || permission.code.startsWith("identity.")), false);
        const systemAdminPermissions = await prisma.rolePermission.findMany({
          where: { roleId: systemAdminRole.id },
          include: { permission: true },
        });
        for (const permissionCode of ["master.read", "purchase.read", "production.read", "stocktake.read"]) {
          assert.ok(systemAdminPermissions.some(({ permission }) => permission.code === permissionCode), permissionCode);
        }

        const createdResponse = await request(adminSession, "/authorization/roles", {
          method: "POST",
          body: { code: "OPERATIONS_VIEWER", name: "Operations viewer", description: "Can read operational records." },
        });
        assert.equal(createdResponse.status, 201);
        const role = await createdResponse.json();
        assert.deepEqual(
          { code: role.code, isSystem: role.isSystem, status: role.status },
          { code: "OPERATIONS_VIEWER", isSystem: false, status: "ACTIVE" },
        );
        assert.equal((await request(adminSession, `/authorization/roles/${systemAdminRole.id}`, { method: "PATCH", body: { status: "DISABLED" } })).status, 403);
        assert.equal((await request(adminSession, `/authorization/roles/${systemAdminRole.id}/permissions/${masterRead.id}`, { method: "POST" })).status, 403);
        assert.equal((await request(adminSession, `/authorization/roles/${role.id}/permissions/${authorizationManage.id}`, { method: "POST" })).status, 422);

        assert.equal((await request(adminSession, `/authorization/roles/${role.id}/permissions/${masterRead.id}`, { method: "POST" })).status, 204);
        const assignedPermissions = await (await request(readerSession, `/authorization/roles/${role.id}/permissions`)).json();
        assert.deepEqual(assignedPermissions.map((permission) => permission.code), ["master.read"]);
        assert.equal((await request(adminSession, `/authorization/users/${target.id}/roles/${role.id}`, { method: "POST" })).status, 204);
        assert.deepEqual((await (await request(readerSession, `/authorization/users/${target.id}/roles`)).json()).map((assignedRole) => assignedRole.id), [role.id]);
        assert.ok((await (await request(targetSession, "/auth/me/permissions")).json()).permissions.includes("master.read"));

        const disabledResponse = await request(adminSession, `/authorization/roles/${role.id}`, { method: "PATCH", body: { status: "DISABLED" } });
        assert.equal(disabledResponse.status, 200);
        assert.equal((await disabledResponse.json()).status, "DISABLED");
        assert.equal((await (await request(targetSession, "/auth/me/permissions")).json()).permissions.includes("master.read"), false);
        assert.equal((await request(adminSession, `/authorization/roles/${role.id}`, { method: "PATCH", body: { status: "ACTIVE" } })).status, 200);
        assert.ok((await (await request(targetSession, "/auth/me/permissions")).json()).permissions.includes("master.read"));

        assert.equal((await request(adminSession, `/authorization/users/${target.id}/roles/${role.id}`, { method: "DELETE" })).status, 204);
        const concurrentGrant = await Promise.all([
          request(adminSession, `/authorization/users/${target.id}/roles/${role.id}`, { method: "POST" }),
          request(adminSession, `/authorization/users/${target.id}/roles/${role.id}`, { method: "POST" }),
        ]);
        assert.deepEqual((await Promise.all(concurrentGrant.map((response) => response.status))).sort(), [204, 409]);
        assert.equal(await prisma.userRole.count({ where: { userId: target.id, roleId: role.id } }), 1);

        const auditActions = await prisma.authorizationAuditLog.findMany({
          where: { actorUserId: admin.id, roleId: role.id },
          select: { action: true, source: true },
        });
        for (const action of ["CREATE_CUSTOM_ROLE", "GRANT_ROLE_PERMISSION", "GRANT_USER_ROLE", "REVOKE_USER_ROLE", "UPDATE_CUSTOM_ROLE"]) {
          assert.ok(auditActions.some((entry) => entry.action === action && entry.source === "AUTHORIZATION_API"), action);
        }

        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: systemAdminRole.id, permissionId: authorizationManage.id } } });
        assert.equal((await request(adminSession, "/authorization/roles", { method: "POST", body: { code: "REVOKED_MANAGE", name: "Denied after revoke" } })).status, 403);
        assert.equal((await request(adminSession, "/auth/me")).status, 200);
        await prisma.rolePermission.create({ data: { roleId: systemAdminRole.id, permissionId: authorizationManage.id } });

        const rollbackCode = `AUDIT_ROLLBACK_${Date.now()}`;
        const functionName = `pr005f1_authorization_audit_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."action" = 'CREATE_CUSTOM_ROLE'::"AuthorizationAuditAction" THEN RAISE EXCEPTION 'forced authorization audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuthorizationAuditLog" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        try {
          assert.equal((await request(adminSession, "/authorization/roles", { method: "POST", body: { code: rollbackCode, name: "Must roll back" } })).status, 500);
          assert.equal(await prisma.role.count({ where: { code: rollbackCode } }), 0);
          assert.equal(await prisma.authorizationAuditLog.count({ where: { role: { code: rollbackCode } } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "AuthorizationAuditLog";`);
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
    }

    test("authorization PostgreSQL and HTTP proof preserves system safety, audits, immediate effects, and concurrent assignments", runAuthorizationAdministrationRealDatabaseProof);
  }
}
