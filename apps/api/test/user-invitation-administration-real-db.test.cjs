const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const databaseUrl = process.env.USER_INVITATION_ADMIN_DATABASE_URL;

if (databaseUrl === undefined) {
  test("user invitation administration real database proof is opt-in", { skip: "USER_INVITATION_ADMIN_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_invitation_ui_test_[a-z0-9_]+$/.test(databaseName)) {
    test("user invitation administration real database proof requires an isolated database", () => {
      assert.fail("USER_INVITATION_ADMIN_DATABASE_URL must target lotus_brain_invitation_ui_test_<name>.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("invitation administration HTTP proof preserves identity.manage, CSRF, safe conflict handling, audit atomicity, and immediate revocation", async () => {
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
      const fixture = `pr005g-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
            activatedAt: new Date(),
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
        const [systemAdminRole, identityManage] = await Promise.all([
          prisma.role.findUniqueOrThrow({ where: { code: "SYSTEM_ADMIN" } }),
          prisma.permission.findUniqueOrThrow({ where: { code: "identity.manage" } }),
        ]);
        const [admin, reader, existingUser] = await Promise.all([createUser("admin"), createUser("reader"), createUser("existing")]);
        await prisma.userRole.create({ data: { userId: admin.id, roleId: systemAdminRole.id } });
        const [adminSession, readerSession] = await Promise.all([createSession(admin, "admin"), createSession(reader, "reader")]);

        await startApp();
        assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
        assert.equal((await request(null, "/identity/invitations")).status, 401);
        assert.equal((await request(readerSession, "/identity/invitations")).status, 403);
        assert.equal((await request(readerSession, "/auth/me")).status, 200);

        const invitationEmail = `${fixture}-invited@example.test`;
        assert.equal((await request(adminSession, "/identity/invitations", { method: "POST", csrf: false, body: { email: invitationEmail } })).status, 403);
        const createResponse = await request(adminSession, "/identity/invitations", { method: "POST", body: { email: invitationEmail.toUpperCase() } });
        assert.equal(createResponse.status, 201);
        const invitation = await createResponse.json();
        assert.deepEqual(Object.keys(invitation).sort(), ["acceptedAt", "cancelledAt", "createdAt", "email", "id", "status"]);
        assert.deepEqual({ email: invitation.email, status: invitation.status, acceptedAt: invitation.acceptedAt, cancelledAt: invitation.cancelledAt }, {
          email: invitationEmail,
          status: "PENDING",
          acceptedAt: null,
          cancelledAt: null,
        });
        assert.equal(await prisma.user.count({ where: { email: invitationEmail } }), 0);
        assert.equal(await prisma.userRole.count({ where: { userId: admin.id } }), 1);
        assert.equal((await request(adminSession, "/identity/invitations", { method: "POST", body: { email: invitationEmail } })).status, 409);
        assert.equal((await request(adminSession, "/identity/invitations", { method: "POST", body: { email: existingUser.email } })).status, 409);
        assert.equal((await request(adminSession, "/identity/invitations", { method: "POST", body: { email: `${fixture}-invalid@example.test`, roleId: systemAdminRole.id } })).status, 400);

        const listResponse = await request(adminSession, "/identity/invitations?status=PENDING&limit=100&offset=0");
        assert.equal(listResponse.status, 200);
        assert.ok((await listResponse.json()).some((entry) => entry.id === invitation.id));
        assert.equal((await request(adminSession, `/identity/invitations/${invitation.id}`)).status, 200);
        assert.equal((await request(adminSession, `/identity/invitations/${invitation.id}/resend`, { method: "POST" })).status, 409);
        await prisma.notificationOutbox.updateMany({
          where: { invitationId: invitation.id, kind: "USER_INVITATION" },
          data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
        });
        const resendResponse = await request(adminSession, `/identity/invitations/${invitation.id}/resend`, { method: "POST" });
        assert.equal(resendResponse.status, 202);
        assert.deepEqual(await resendResponse.json(), { status: "accepted" });

        const concurrent = await Promise.all([
          request(adminSession, `/identity/invitations/${invitation.id}`, { method: "DELETE" }),
          request(adminSession, `/identity/invitations/${invitation.id}`, { method: "DELETE" }),
        ]);
        assert.deepEqual((await Promise.all(concurrent.map((response) => response.status))).sort(), [200, 409]);
        assert.equal(await prisma.userInvitation.findUniqueOrThrow({ where: { id: invitation.id } }).then((entry) => entry.status), "CANCELLED");
        assert.equal(await prisma.identityAuditLog.count({ where: { action: "USER_INVITATION_CANCELLED", actorUserId: admin.id } }), 1);

        const rollbackEmail = `${fixture}-rollback@example.test`;
        const rollback = await prisma.userInvitation.create({
          data: { email: rollbackEmail, status: "PENDING", createdByUserId: admin.id },
        });
        const functionName = `pr005g_invitation_audit_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."action" = 'USER_INVITATION_CANCELLED'::"IdentityAuditAction" THEN RAISE EXCEPTION 'forced invitation audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "IdentityAuditLog" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        try {
          assert.equal((await request(adminSession, `/identity/invitations/${rollback.id}`, { method: "DELETE" })).status, 500);
          assert.equal((await prisma.userInvitation.findUniqueOrThrow({ where: { id: rollback.id } })).status, "PENDING");
          assert.equal(await prisma.identityAuditLog.count({ where: { action: "USER_INVITATION_CANCELLED", actorUserId: admin.id } }), 1);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "IdentityAuditLog";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }

        await app.close();
        app = undefined;
        await startApp();
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: systemAdminRole.id, permissionId: identityManage.id } } });
        assert.equal((await request(adminSession, "/identity/invitations", { method: "POST", body: { email: `${fixture}-revoked@example.test` } })).status, 403);
        assert.equal((await request(adminSession, "/auth/me")).status, 200);
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
