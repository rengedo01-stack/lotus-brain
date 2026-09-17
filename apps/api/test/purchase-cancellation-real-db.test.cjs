const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PURCHASE_CANCELLATION_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006c24_purchase_cancellation_test";

if (databaseUrl === undefined) {
  test("purchase cancellation real database proof is opt-in", { skip: "PURCHASE_CANCELLATION_DATABASE_URL is not set" }, () => {});
} else if (decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) !== allowedDatabaseName) {
  test("purchase cancellation real database proof requires its dedicated disposable database", () => {
    assert.fail(`PURCHASE_CANCELLATION_DATABASE_URL must target ${allowedDatabaseName}.`);
  });
} else {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { NestFactory } = require("@nestjs/core");
  const { ValidationPipe } = require("@nestjs/common");
  const { DocumentBuilder, SwaggerModule } = require("@nestjs/swagger");
  const cookieParser = require("cookie-parser");
  const { PrismaClient } = require("../dist/generated/prisma/client.js");
  const { PrismaPurchaseDraftRepository } = require("../dist/modules/purchase/infrastructure/purchase-draft.repository.js");
  const hash = (value) => createHash("sha256").update(value).digest("hex");

  test("purchase cancellation is reasoned, state-authorized, terminal, and serialized against confirm/post", async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = "test";
    process.env.CORS_ORIGIN = "http://localhost:4311";
    process.env.PUBLIC_WEB_BASE_URL = "http://localhost:4311";
    process.env.WEBAUTHN_ORIGIN = "http://localhost:4311";
    process.env.WEBAUTHN_RP_ID = "localhost";
    process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
    process.env.LOG_LEVEL = "error";
    process.env.CSRF_LEGACY_SCALAR_FALLBACK = "false";
    const { AppModule } = require("../dist/app.module.js");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const fixture = `c24-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    let app;
    let requestNumber = 0;

    const startApp = async () => {
      app = await NestFactory.create(AppModule, { logger: false });
      app.getHttpAdapter().getInstance().set("trust proxy", 1);
      app.use(cookieParser());
      app.setGlobalPrefix("api/v1");
      app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
      await app.listen(0, "127.0.0.1");
      return `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
    };

    try {
      const unit = await prisma.unit.create({ data: { code: `${fixture}-UNIT`, name: "Each", symbol: "ea", dimension: "COUNT" } });
      const product = await prisma.product.create({ data: { code: `${fixture}-PRODUCT`, name: "Product", baseUnitId: unit.id, inventoryUnitId: unit.id } });
      const supplier = await prisma.supplier.create({ data: { code: `${fixture}-SUPPLIER`, name: "Supplier" } });
      const [writer, confirmer, poster, denied] = await Promise.all([
        prisma.user.create({ data: { email: `${fixture}-writer@example.test`, displayName: "writer", passwordHash: "unused" } }),
        prisma.user.create({ data: { email: `${fixture}-confirmer@example.test`, displayName: "confirmer", passwordHash: "unused" } }),
        prisma.user.create({ data: { email: `${fixture}-poster@example.test`, displayName: "poster", passwordHash: "unused" } }),
        prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "denied", passwordHash: "unused" } }),
      ]);
      const [writeRole, confirmRole, postRole, deniedRole] = await Promise.all([
        prisma.role.create({ data: { code: `${fixture}-WRITE`, name: "write" } }),
        prisma.role.create({ data: { code: `${fixture}-CONFIRM`, name: "confirm" } }),
        prisma.role.create({ data: { code: `${fixture}-POST`, name: "post" } }),
        prisma.role.create({ data: { code: `${fixture}-DENIED`, name: "denied" } }),
      ]);
      const [writePermission, confirmPermission, postPermission, readPermission] = await Promise.all([
        prisma.permission.findUniqueOrThrow({ where: { code: "purchase.write" } }),
        prisma.permission.findUniqueOrThrow({ where: { code: "purchase.confirm" } }),
        prisma.permission.findUniqueOrThrow({ where: { code: "purchase.post" } }),
        prisma.permission.findUniqueOrThrow({ where: { code: "purchase.read" } }),
      ]);
      await prisma.rolePermission.createMany({ data: [
        { roleId: writeRole.id, permissionId: writePermission.id },
        { roleId: writeRole.id, permissionId: readPermission.id },
        { roleId: confirmRole.id, permissionId: confirmPermission.id },
        { roleId: postRole.id, permissionId: postPermission.id },
      ] });
      await prisma.userRole.createMany({ data: [
        { userId: writer.id, roleId: writeRole.id }, { userId: confirmer.id, roleId: confirmRole.id },
        { userId: poster.id, roleId: postRole.id }, { userId: denied.id, roleId: deniedRole.id },
      ] });
      const createSession = async (user, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const session = await prisma.identitySession.create({ data: {
          userId: user.id, tokenHash: hash(token), csrfTokenHash: hash(csrf), credentialVersion: user.credentialVersion,
          authenticationPolicyVersion: user.authenticationPolicyVersion, expiresAt: new Date(Date.now() + 300_000), activatedAt: new Date(),
        } });
        await prisma.identityCsrfToken.create({ data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt } });
        return { token, csrf };
      };
      const [writerSession, confirmerSession, posterSession, deniedSession] = await Promise.all([
        createSession(writer, "writer"), createSession(confirmer, "confirmer"), createSession(poster, "poster"), createSession(denied, "denied"),
      ]);
      const baseUrl = await startApp();
      const request = (method, path, session, body, csrf = true) => fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json", "x-forwarded-for": `127.0.0.${++requestNumber}`,
          ...(session === undefined ? {} : { cookie: `lotus_session=${session.token}` }),
          ...(method === "GET" || session === undefined || !csrf ? {} : { "x-csrf-token": session.csrf }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const repository = new PrismaPurchaseDraftRepository(prisma);
      const createDraft = (suffix) => repository.create({
        supplierId: supplier.id, purchaseDate: "2026-09-15T00:00:00.000Z", documentNumber: `${fixture}-${suffix}`,
        items: [{ productId: product.id, unitId: unit.id, quantity: "2.000000000", unitPrice: "12.345678", taxRate: "0.1000" }],
      });
      const cancel = (id, session, reason = "supplier withdrew", csrf = true) => request("POST", `/purchases/${id}/cancel`, session, { reason }, csrf);

      assert.equal((await request("POST", "/purchases/missing/cancel", undefined, { reason: "x" })).status, 401);
      const draft = await createDraft("draft");
      assert.equal((await cancel(draft.id, deniedSession)).status, 403);
      assert.equal((await cancel(draft.id, writerSession, " ")).status, 400);
      assert.equal((await cancel(draft.id, writerSession, "missing csrf", false)).status, 403);
      const cancelledResponse = await cancel(draft.id, writerSession, "  supplier withdrew stock  ");
      assert.equal(cancelledResponse.status, 200);
      assert.equal(cancelledResponse.headers.get("cache-control"), "private, no-store");
      const cancelledBody = await cancelledResponse.json();
      assert.deepEqual(Object.keys(cancelledBody).sort(), ["cancellationReason", "cancelledAt", "id", "status"]);
      assert.equal(cancelledBody.status, "CANCELLED");
      assert.equal(cancelledBody.cancellationReason, "supplier withdrew stock");
      assert.equal(new Date(cancelledBody.cancelledAt).toISOString(), cancelledBody.cancelledAt);
      const cancelledDetailResponse = await request("GET", `/purchases/${draft.id}`, writerSession);
      assert.equal(cancelledDetailResponse.status, 200);
      assert.equal(cancelledDetailResponse.headers.get("cache-control"), "private, no-store");
      const cancelledDetail = await cancelledDetailResponse.json();
      assert.deepEqual(Object.keys(cancelledDetail).sort(), ["cancellationReason", "cancelledAt", "createdAt", "documentNumber", "id", "items", "note", "postedAt", "purchaseDate", "status", "subtotal", "supplier", "tax", "total", "updatedAt"]);
      assert.equal(cancelledDetail.status, "CANCELLED");
      assert.equal(cancelledDetail.postedAt, null);
      assert.equal(cancelledDetail.cancelledAt, cancelledBody.cancelledAt);
      assert.equal(cancelledDetail.cancellationReason, "supplier withdrew stock");
      const cancelled = await prisma.purchase.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true, logs: true } });
      assert.equal(cancelled.status, "CANCELLED");
      assert.equal(cancelled.cancellationReason, "supplier withdrew stock");
      assert.ok(cancelled.cancelledAt);
      assert.equal(cancelled.logs.filter((entry) => entry.toStatus === "CANCELLED" && entry.note === "supplier withdrew stock").length, 1);
      assert.equal((await cancel(draft.id, writerSession)).status, 409);
      await assert.rejects(() => prisma.purchase.update({ where: { id: draft.id }, data: { note: "rewrite" } }), /terminal/i);
      await assert.rejects(() => prisma.purchaseItem.update({ where: { id: cancelled.items[0].id }, data: { quantity: "3" } }), /only change while.*DRAFT/i);
      await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE "Purchase" SET "status" = 'DRAFT' WHERE "id" = '${draft.id}'`), /terminal/i);

      const confirmed = await createDraft("confirmed");
      assert.notEqual(await repository.confirm(confirmed.id), "CONFLICT");
      assert.equal((await cancel(confirmed.id, writerSession)).status, 403);
      assert.equal((await cancel(confirmed.id, confirmerSession, "confirmed cancellation")).status, 200);

      const posted = await createDraft("posted");
      assert.equal((await request("POST", `/purchases/${posted.id}/post`, posterSession)).status, 200);
      assert.equal((await cancel(posted.id, writerSession)).status, 409);
      await assert.rejects(() => prisma.purchase.update({ where: { id: posted.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "not allowed" } }), /terminal/i);

      const confirmRace = await createDraft("confirm-race");
      const [cancelRace, confirmRaceResponse] = await Promise.all([
        cancel(confirmRace.id, writerSession, "race cancel"), request("POST", `/purchases/${confirmRace.id}/confirm`, confirmerSession),
      ]);
      // If confirm wins first, the locked-state authorization re-evaluates the
      // cancellation as CONFIRMED and correctly rejects the write-only actor.
      assert.ok(
        (cancelRace.status === 200 && confirmRaceResponse.status === 409)
        || (cancelRace.status === 403 && confirmRaceResponse.status === 201),
      );
      assert.ok(["CANCELLED", "CONFIRMED"].includes((await prisma.purchase.findUniqueOrThrow({ where: { id: confirmRace.id } })).status));

      const postRace = await createDraft("post-race");
      const [cancelPostRace, postRaceResponse] = await Promise.all([
        cancel(postRace.id, writerSession, "race cancel"), request("POST", `/purchases/${postRace.id}/post`, posterSession),
      ]);
      assert.deepEqual([cancelPostRace.status, postRaceResponse.status].sort(), [200, 409]);
      assert.ok(["CANCELLED", "POSTED"].includes((await prisma.purchase.findUniqueOrThrow({ where: { id: postRace.id } })).status));

      const swagger = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("C24A").build());
      const cancelSwagger = swagger.paths["/api/v1/purchases/{id}/cancel"].post;
      assert.equal(cancelSwagger.responses["200"].content["application/json"].schema.additionalProperties, false);
      assert.equal(cancelSwagger.requestBody.content["application/json"].schema.additionalProperties, false);
      assert.deepEqual(cancelSwagger.requestBody.content["application/json"].schema.required, ["reason"]);
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });
}
