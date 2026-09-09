const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");

const databaseUrl = process.env.PRODUCTION_LIST_DATABASE_URL;
const allowedDatabaseName = "lotus_brain_pr006b2_production_list_test";

if (databaseUrl === undefined) {
  test("production list real database proof is opt-in", { skip: "PRODUCTION_LIST_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (databaseName !== allowedDatabaseName) {
    test("production list real database proof requires its dedicated disposable database", () => {
      assert.fail(`PRODUCTION_LIST_DATABASE_URL must target ${allowedDatabaseName}.`);
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { Client } = require("pg");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("production list HTTP proof preserves narrow snapshots, read permission, bound keysets, and list indexes", async () => {
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
      const fixture = `b2-${randomUUID().replace(/-/g, "").slice(0, 18)}`;
      let app;

      const createSession = async (userId, suffix) => {
        const token = `${fixture}-${suffix}-session`;
        const csrf = `${fixture}-${suffix}-csrf`;
        const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const session = await prisma.identitySession.create({
          data: {
            userId,
            tokenHash: hash(token),
            csrfTokenHash: hash(csrf),
            credentialVersion: user.credentialVersion,
            authenticationPolicyVersion: user.authenticationPolicyVersion,
            expiresAt: new Date(Date.now() + 5 * 60_000),
            activatedAt: new Date(),
          },
        });
        await prisma.identityCsrfToken.create({
          data: { identitySessionId: session.id, tokenHash: hash(csrf), expiresAt: session.expiresAt },
        });
        return token;
      };

      const createRecipe = async (suffix, outputProductId, unitId) => {
        const id = `${fixture}-recipe-${suffix}`;
        await prisma.recipe.create({
          data: {
            id,
            rootRecipeId: id,
            name: `${fixture} recipe ${suffix}`,
            outputProductId,
            yieldQuantity: "1.000000000",
            yieldUnitId: unitId,
            // Recipe creation itself is DRAFT-only. It becomes ACTIVE only
            // after a valid, inventory-unit recipe item exists.
            status: "DRAFT",
            revision: 1,
          },
        });
        await prisma.recipeItem.create({
          data: { recipeId: id, productId: outputProductId, unitId, quantity: "1.000000000", sortOrder: 0 },
        });
        await prisma.recipe.update({ where: { id }, data: { status: "ACTIVE" } });
        return id;
      };

      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.getHttpAdapter().getInstance().set("trust proxy", 1);
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        return `http://127.0.0.1:${address.port}/api/v1`;
      };

      try {
        const unit = await prisma.unit.create({
          data: { code: `${fixture}-u`, name: "PR-006B2 unit", symbol: "u", dimension: "COUNT", status: "ACTIVE" },
        });
        const historicalOutput = await prisma.product.create({
          data: { code: `${fixture}-historical`, name: "Production output at creation", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" },
        });
        const indexedOutput = await prisma.product.create({
          data: { code: `${fixture}-indexed`, name: "Indexed output", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" },
        });
        const noiseOutput = await prisma.product.create({
          data: { code: `${fixture}-noise`, name: "Planner noise output", baseUnitId: unit.id, inventoryUnitId: unit.id, status: "ACTIVE" },
        });
        const historicalRecipeId = await createRecipe("historical", historicalOutput.id, unit.id);
        const indexedRecipeId = await createRecipe("indexed", indexedOutput.id, unit.id);
        const noiseRecipeId = await createRecipe("noise", noiseOutput.id, unit.id);
        const sharedDate = new Date("2026-09-08T00:00:00.000Z");
        const olderDate = new Date("2026-09-07T00:00:00.000Z");

        await prisma.production.createMany({
          data: [
            { id: `${fixture}-production-003`, recipeId: historicalRecipeId, productionDate: sharedDate, plannedQuantity: "1.000000000", outputProductIdSnapshot: historicalOutput.id, yieldQuantitySnapshot: "1.000000000", outputUnitIdSnapshot: unit.id, outputConversionFactorSnapshot: "1.000000000000" },
            { id: `${fixture}-production-002`, recipeId: historicalRecipeId, productionDate: sharedDate, plannedQuantity: "1.000000000", outputProductIdSnapshot: historicalOutput.id, yieldQuantitySnapshot: "1.000000000", outputUnitIdSnapshot: unit.id, outputConversionFactorSnapshot: "1.000000000000" },
            { id: `${fixture}-production-001`, recipeId: historicalRecipeId, productionDate: sharedDate, plannedQuantity: "1.000000000", outputProductIdSnapshot: historicalOutput.id, yieldQuantitySnapshot: "1.000000000", outputUnitIdSnapshot: unit.id, outputConversionFactorSnapshot: "1.000000000000" },
            { id: `${fixture}-production-older`, recipeId: historicalRecipeId, productionDate: olderDate, plannedQuantity: "1.000000000", outputProductIdSnapshot: historicalOutput.id, yieldQuantitySnapshot: "1.000000000", outputUnitIdSnapshot: unit.id, outputConversionFactorSnapshot: "1.000000000000" },
          ],
        });
        await prisma.production.update({ where: { id: `${fixture}-production-002` }, data: { status: "CONFIRMED" } });

        await prisma.production.createMany({
          data: Array.from({ length: 5_000 }, (_, index) => {
            const targeted = index % 10 === 0;
            return {
              id: `${fixture}-index-${String(index).padStart(4, "0")}`,
              recipeId: targeted ? indexedRecipeId : noiseRecipeId,
              productionDate: new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60, index % 1_000)),
              plannedQuantity: "1.000000000",
              outputProductIdSnapshot: targeted ? indexedOutput.id : noiseOutput.id,
              yieldQuantitySnapshot: "1.000000000",
              outputUnitIdSnapshot: unit.id,
              outputConversionFactorSnapshot: "1.000000000000",
            };
          }),
        });

        await prisma.product.update({
          where: { id: historicalOutput.id },
          data: { code: `${fixture}-renamed`, name: "Current master name must not be listed", status: "INACTIVE", deletedAt: new Date("2026-09-09T00:00:00.000Z") },
        });

        const admin = await prisma.user.create({ data: { email: `${fixture}-admin@example.test`, displayName: "PR-006B2 admin", passwordHash: "not-used" } });
        const denied = await prisma.user.create({ data: { email: `${fixture}-denied@example.test`, displayName: "PR-006B2 denied", passwordHash: "not-used" } });
        const noReadRole = await prisma.role.create({ data: { code: `${fixture}-no-production-read`, name: "PR-006B2 no production read" } });
        await prisma.userRole.createMany({ data: [
          { userId: admin.id, roleId: "rbac-role-system-admin" },
          { userId: denied.id, roleId: noReadRole.id },
        ] });
        const permission = await prisma.permission.findUniqueOrThrow({ where: { code: "production.read" } });
        assert.ok(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: permission.id } } }));
        assert.equal(await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: noReadRole.id, permissionId: permission.id } } }), null);

        const adminToken = await createSession(admin.id, "admin");
        const deniedToken = await createSession(denied.id, "denied");
        const baseUrl = await startApp();
        assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
        let requestNumber = 0;
        const get = (path, token) => {
          requestNumber += 1;
          return fetch(`${baseUrl}${path}`, {
            headers: { "x-forwarded-for": `127.0.0.${requestNumber}`, ...(token === undefined ? {} : { cookie: `lotus_session=${token}` }) },
          });
        };

        assert.equal((await get("/productions")).status, 401);
        assert.equal((await get("/productions", deniedToken)).status, 403);

        const firstResponse = await get(`/productions?limit=2&outputProductIdSnapshot=${encodeURIComponent(historicalOutput.id)}`, adminToken);
        assert.equal(firstResponse.status, 200);
        const first = await firstResponse.json();
        assert.deepEqual(Object.keys(first).sort(), ["items", "nextCursor"]);
        assert.deepEqual(first.items.map((item) => item.id), [`${fixture}-production-003`, `${fixture}-production-002`]);
        assert.equal(typeof first.nextCursor, "string");
        assert.ok(first.items.every((item) => Object.keys(item).sort().join(",") === "cancelledAt,id,outputProductIdSnapshot,postedAt,productionDate,recipe,status"));
        assert.ok(first.items.every((item) => Object.keys(item.recipe).sort().join(",") === "id,revision,rootRecipeId"));
        assert.ok(first.items.every((item) => item.outputProductIdSnapshot === historicalOutput.id));
        assert.equal(JSON.stringify(first).match(/Current master name|productCode|productName|recipeName|amount|cost|currency|consumptions|note|confirmedAt/i), null);

        const nextResponse = await get(`/productions?limit=2&outputProductIdSnapshot=${encodeURIComponent(historicalOutput.id)}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken);
        assert.equal(nextResponse.status, 200);
        const next = await nextResponse.json();
        assert.deepEqual(next.items.map((item) => item.id), [`${fixture}-production-001`, `${fixture}-production-older`]);
        assert.equal(next.nextCursor, null);

        const statusResponse = await get(`/productions?status=CONFIRMED&outputProductIdSnapshot=${encodeURIComponent(historicalOutput.id)}`, adminToken);
        assert.equal(statusResponse.status, 200);
        assert.deepEqual((await statusResponse.json()).items.map((item) => item.id), [`${fixture}-production-002`]);
        const recipeResponse = await get(`/productions?recipeId=${encodeURIComponent(historicalRecipeId)}`, adminToken);
        assert.equal(recipeResponse.status, 200);
        assert.equal((await recipeResponse.json()).items.length, 4);
        const dateResponse = await get(`/productions?from=2026-09-08T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z&outputProductIdSnapshot=${encodeURIComponent(historicalOutput.id)}`, adminToken);
        assert.equal(dateResponse.status, 200);
        assert.deepEqual((await dateResponse.json()).items.map((item) => item.id), [`${fixture}-production-003`, `${fixture}-production-002`, `${fixture}-production-001`]);

        assert.equal((await get(`/productions?limit=2&status=DRAFT&outputProductIdSnapshot=${encodeURIComponent(historicalOutput.id)}&cursor=${encodeURIComponent(first.nextCursor)}`, adminToken)).status, 400);
        assert.equal((await get("/productions?cursor=not-a-cursor", adminToken)).status, 400);
        assert.equal((await get("/productions?from=2026-09-08", adminToken)).status, 400);
        assert.equal((await get("/productions?from=2026-09-09T00%3A00%3A00.000Z&to=2026-09-08T00%3A00%3A00.000Z", adminToken)).status, 400);

        await prisma.$executeRawUnsafe('ANALYZE "Production"');
        const byDatePlan = await prisma.$queryRawUnsafe('EXPLAIN (FORMAT JSON) SELECT "id" FROM "Production" ORDER BY "productionDate" DESC, "id" DESC LIMIT 50');
        assert.match(JSON.stringify(byDatePlan), /Production_productionDate_id_desc_idx/);
        const byRecipePlan = await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT "id" FROM "Production" WHERE "recipeId" = '${indexedRecipeId}' ORDER BY "productionDate" DESC, "id" DESC LIMIT 50`);
        assert.match(JSON.stringify(byRecipePlan), /Production_recipeId_productionDate_id_desc_idx/);
        const bySnapshotPlan = await prisma.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) SELECT "id" FROM "Production" WHERE "outputProductIdSnapshot" = '${indexedOutput.id}' ORDER BY "productionDate" DESC, "id" DESC LIMIT 50`);
        assert.match(JSON.stringify(bySnapshotPlan), /Production_outputProductIdSnapshot_productionDate_id_desc_idx/);
      } finally {
        await app?.close();
        await prisma.$disconnect();
        const cleanupUrl = new URL(databaseUrl);
        cleanupUrl.pathname = "/postgres";
        cleanupUrl.searchParams.delete("schema");
        const cleanupClient = new Client({ connectionString: cleanupUrl.toString() });
        await cleanupClient.connect();
        try {
          await cleanupClient.query(`DROP DATABASE IF EXISTS "${allowedDatabaseName}" WITH (FORCE);`);
        } finally {
          await cleanupClient.end();
        }
      }
    });
  }
}
