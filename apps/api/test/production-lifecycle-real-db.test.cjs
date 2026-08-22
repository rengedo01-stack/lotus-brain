const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");

const databaseUrl = process.env.PRODUCTION_LIFECYCLE_DATABASE_URL;

if (databaseUrl === undefined) {
  test("production lifecycle real database proof is opt-in", { skip: "PRODUCTION_LIFECYCLE_DATABASE_URL is not set" }, () => {});
} else {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^lotus_brain_pr005e1(?:_[a-z0-9_]+)?$/.test(databaseName)) {
    test("production lifecycle real database proof requires an isolated database", () => {
      assert.fail("PRODUCTION_LIFECYCLE_DATABASE_URL must target lotus_brain_pr005e1 or a named isolated derivative.");
    });
  } else {
    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require("../dist/generated/prisma/client.js");
    const { NestFactory } = require("@nestjs/core");
    const { ValidationPipe } = require("@nestjs/common");
    const cookieParser = require("cookie-parser");
    const { AppModule } = require("../dist/app.module.js");

    const hash = (value) => createHash("sha256").update(value).digest("hex");

    test("production PostgreSQL and HTTP proof preserves lifecycle, snapshots, permissions, concurrency, and rollback", async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.NODE_ENV = "test";
      process.env.CORS_ORIGIN = "http://localhost:3000";
      process.env.PUBLIC_WEB_BASE_URL = "http://localhost:3000";
      process.env.WEBAUTHN_ORIGIN = "http://localhost:3000";
      process.env.WEBAUTHN_RP_ID = "localhost";
      process.env.WEBAUTHN_RP_NAME = "Lotus BRAIN";
      process.env.LOG_LEVEL = "error";

      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
      const fixture = `pr005e1-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const sessionToken = `${fixture}-session`;
      const csrfToken = `${fixture}-csrf`;
      let gram;
      let kilogram;
      let output;
      let ingredient;
      let app;
      let baseUrl;

      const request = async (path, options = {}) => {
        const method = options.method ?? "GET";
        const headers = {
          cookie: `lotus_session=${sessionToken}`,
          ...(method === "GET" ? {} : { "x-csrf-token": csrfToken }),
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.headers ?? {}),
        };
        return fetch(`${baseUrl}/api/v1${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      };
      const json = async (response) => ({ response, body: await response.json() });
      const settle = async (promise) => Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("concurrent lifecycle request timed out")), 10_000)),
      ]);
      const startApp = async () => {
        app = await NestFactory.create(AppModule, { logger: false });
        app.use(cookieParser());
        app.setGlobalPrefix("api/v1");
        app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
        await app.listen(0, "127.0.0.1");
        const address = app.getHttpServer().address();
        baseUrl = `http://127.0.0.1:${address.port}`;
      };

      async function createRecipe(status = "ACTIVE", ingredientProductId) {
        const id = randomUUID();
        await prisma.recipe.create({
          data: {
            id,
            rootRecipeId: id,
            name: `${fixture} recipe ${id.slice(0, 6)}`,
            outputProductId: output.id,
            yieldQuantity: "2.000000000",
            yieldUnitId: kilogram.id,
            status: "DRAFT",
            revision: 1,
          },
        });
        await prisma.recipeItem.create({
          data: { recipeId: id, productId: ingredientProductId ?? ingredient.id, unitId: kilogram.id, quantity: "1.000000000", sortOrder: 0 },
        });
        if (status === "ACTIVE") await prisma.recipe.update({ where: { id }, data: { status: "ACTIVE" } });
        return id;
      }

      async function createAndConfirm(recipeId, note = "production") {
        const created = await json(await request("/productions", {
          method: "POST",
          body: { recipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "3.000000000", note },
        }));
        assert.equal(created.response.status, 201, JSON.stringify(created.body));
        const confirmed = await request(`/productions/${created.body.id}/confirm`, { method: "POST", body: {} });
        assert.equal(confirmed.status, 201);
        return created.body;
      }

      try {
        gram = await prisma.unit.create({ data: { code: `${fixture}-g`, name: "gram", symbol: "g", dimension: "MASS", status: "ACTIVE" } });
        kilogram = await prisma.unit.create({ data: { code: `${fixture}-kg`, name: "kilogram", symbol: "kg", dimension: "MASS", status: "ACTIVE" } });
        output = await prisma.product.create({
          data: { code: `${fixture}-output`, name: "output", baseUnitId: gram.id, inventoryUnitId: gram.id, status: "ACTIVE" },
        });
        ingredient = await prisma.product.create({
          data: { code: `${fixture}-ingredient`, name: "ingredient", baseUnitId: gram.id, inventoryUnitId: gram.id, status: "ACTIVE" },
        });
        await prisma.productUnitConversion.createMany({ data: [
          { productId: output.id, unitId: kilogram.id, factorToBaseUnit: "1000.000000000", status: "ACTIVE" },
          { productId: ingredient.id, unitId: kilogram.id, factorToBaseUnit: "1000.000000000", status: "ACTIVE" },
        ] });
        await prisma.inventory.createMany({ data: [
          { productId: output.id, quantity: "0", averageUnitCost: null },
          { productId: ingredient.id, quantity: "100000", averageUnitCost: "2.000000" },
        ] });
        const activeRecipeId = await createRecipe("ACTIVE");
        const draftRecipeId = await createRecipe("DRAFT");

        const user = await prisma.user.create({
          data: { email: `${fixture}@example.test`, displayName: "Production tester", passwordHash: "not-used" },
        });
        await prisma.userRole.create({ data: { userId: user.id, roleId: "rbac-role-system-admin" } });
        await prisma.identitySession.create({
          data: {
            userId: user.id,
            tokenHash: hash(sessionToken),
            csrfTokenHash: hash(csrfToken),
            credentialVersion: 1,
            authenticationPolicyVersion: 1,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });

        await startApp();

        assert.equal((await fetch(`${baseUrl}/api/v1/health`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/api/v1/productions`, { method: "POST" })).status, 401);
        assert.equal((await fetch(`${baseUrl}/api/v1/productions`, {
          method: "POST",
          headers: { cookie: `lotus_session=${sessionToken}`, "content-type": "application/json" },
          body: JSON.stringify({ recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" }),
        })).status, 403);
        assert.equal((await request("/productions/missing")).status, 404);
        const noPermissionUser = await prisma.user.create({
          data: { email: `${fixture}-denied@example.test`, displayName: "Denied", passwordHash: "not-used" },
        });
        const deniedToken = `${fixture}-denied-session`;
        const deniedCsrfToken = `${fixture}-denied-csrf`;
        await prisma.identitySession.create({
          data: {
            userId: noPermissionUser.id,
            tokenHash: hash(deniedToken),
            csrfTokenHash: hash(deniedCsrfToken),
            credentialVersion: 1,
            authenticationPolicyVersion: 1,
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        assert.equal((await fetch(`${baseUrl}/api/v1/productions/missing`, { headers: { cookie: `lotus_session=${deniedToken}` } })).status, 403);

        const deniedCreate = await request("/productions", {
          method: "POST",
          body: { recipeId: draftRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" },
        });
        assert.equal(deniedCreate.status, 422);

        const created = await json(await request("/productions", {
          method: "POST",
          body: { recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "3.000000000", note: "initial" },
        }));
        assert.equal(created.response.status, 201, JSON.stringify(created.body));
        assert.equal(created.body.status, "DRAFT");
        assert.deepEqual(created.body.recipe, { id: activeRecipeId, rootRecipeId: activeRecipeId, revision: 1 });
        assert.equal(created.body.output.conversionFactor, "1000");
        assert.equal(created.body.consumptions[0].recipeQuantitySnapshot, "1");
        assert.equal(created.body.consumptions[0].conversionFactorSnapshot, "1000");
        assert.equal(created.body.consumptions[0].inventoryQuantity, "1000");

        const patched = await json(await request(`/productions/${created.body.id}`, {
          method: "PATCH",
          body: { productionDate: "2026-08-24T00:00:00.000Z", plannedQuantity: "4.000000000", note: "patched" },
        }));
        assert.equal(patched.response.status, 200);
        assert.equal(patched.body.plannedQuantity, "4");
        assert.equal((await request(`/productions/${created.body.id}`, { method: "PATCH", body: { recipeId: activeRecipeId } })).status, 400);

        assert.equal((await request(`/productions/${created.body.id}/confirm`, { method: "POST", body: {} })).status, 201);
        assert.equal((await request(`/productions/${created.body.id}/confirm`, { method: "POST", body: {} })).status, 409);
        assert.equal((await request(`/productions/${created.body.id}`, { method: "PATCH", body: { note: "late" } })).status, 409);

        await prisma.productUnitConversion.update({
          where: { productId_unitId: { productId: output.id, unitId: kilogram.id } },
          data: { factorToBaseUnit: "500.000000000" },
        });
        await prisma.productUnitConversion.update({
          where: { productId_unitId: { productId: ingredient.id, unitId: kilogram.id } },
          data: { factorToBaseUnit: "500.000000000" },
        });
        assert.equal((await request(`/productions/${created.body.id}/post`, { method: "POST", body: { actualQuantity: "3.000000000" } })).status, 200);
        const posted = await prisma.production.findUniqueOrThrow({ where: { id: created.body.id }, include: { consumptions: true, outputInventoryHistory: true } });
        assert.equal(posted.status, "POSTED");
        assert.equal(posted.outputConversionFactorSnapshot.toString(), "1000");
        assert.equal(posted.outputInventoryHistory.quantityDelta.toString(), "3000");
        assert.equal(posted.consumptions[0].conversionFactorSnapshot.toString(), "1000");
        assert.equal(posted.consumptions[0].inventoryQuantity.toString(), "1500");
        assert.equal((await request(`/productions/${created.body.id}/post`, { method: "POST", body: { actualQuantity: "3" } })).status, 409);

        await app.close();
        await startApp();

        const concurrent = await createAndConfirm(activeRecipeId, "concurrent post");
        const concurrentPost = await settle(Promise.all([
          request(`/productions/${concurrent.id}/post`, { method: "POST", body: { actualQuantity: "2" } }),
          request(`/productions/${concurrent.id}/post`, { method: "POST", body: { actualQuantity: "2" } }),
        ]));
        assert.deepEqual((await Promise.all(concurrentPost.map((response) => response.status))).sort(), [200, 409]);
        assert.equal(await prisma.inventoryHistory.count({ where: { OR: [
          { sourceProductionId: concurrent.id },
          { sourceProductionConsumption: { productionId: concurrent.id } },
        ] } }), 2);

        const race = await json(await request("/productions", {
          method: "POST",
          body: { recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "2" },
        }));
        assert.equal(race.response.status, 201);
        const [updateRace, confirmRace, postRace] = await settle(Promise.all([
          request(`/productions/${race.body.id}`, { method: "PATCH", body: { note: "race" } }),
          request(`/productions/${race.body.id}/confirm`, { method: "POST", body: {} }),
          request(`/productions/${race.body.id}/post`, { method: "POST", body: { actualQuantity: "2" } }),
        ]));
        assert.ok([200, 409].includes(updateRace.status));
        assert.equal(confirmRace.status, 201);
        assert.ok([200, 409].includes(postRace.status));

        await app.close();
        await startApp();

        const confirmRollback = await json(await request("/productions", {
          method: "POST",
          body: { recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" },
        }));
        assert.equal(confirmRollback.response.status, 201);
        const confirmFunctionName = `pr005e1_confirm_rollback_${Date.now()}`;
        const confirmTriggerName = `${confirmFunctionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${confirmFunctionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."productionId" = '${confirmRollback.body.id}' THEN RAISE EXCEPTION 'forced production confirmation failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${confirmTriggerName}" BEFORE INSERT ON "ProductionLog" FOR EACH ROW EXECUTE FUNCTION "${confirmFunctionName}"();`);
        try {
          assert.equal((await request(`/productions/${confirmRollback.body.id}/confirm`, { method: "POST", body: {} })).status, 500);
          assert.equal((await prisma.production.findUniqueOrThrow({ where: { id: confirmRollback.body.id } })).status, "DRAFT");
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${confirmTriggerName}" ON "ProductionLog";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${confirmFunctionName}"();`);
        }

        const postRollback = await createAndConfirm(activeRecipeId, "post rollback");
        const postFunctionName = `pr005e1_post_rollback_${Date.now()}`;
        const postTriggerName = `${postFunctionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${postFunctionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."sourceProductionId" = '${postRollback.id}' THEN RAISE EXCEPTION 'forced production posting failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${postTriggerName}" BEFORE INSERT ON "InventoryHistory" FOR EACH ROW EXECUTE FUNCTION "${postFunctionName}"();`);
        try {
          assert.equal((await request(`/productions/${postRollback.id}/post`, { method: "POST", body: { actualQuantity: "2" } })).status, 500);
          assert.equal((await prisma.production.findUniqueOrThrow({ where: { id: postRollback.id } })).status, "CONFIRMED");
          assert.equal(await prisma.inventoryHistory.count({ where: { OR: [
            { sourceProductionId: postRollback.id },
            { sourceProductionConsumption: { productionId: postRollback.id } },
          ] } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${postTriggerName}" ON "InventoryHistory";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${postFunctionName}"();`);
        }

        const rollbackIngredient = await prisma.product.create({
          data: { code: `${fixture}-rollback-ingredient`, name: "rollback ingredient", baseUnitId: gram.id, inventoryUnitId: gram.id, status: "ACTIVE" },
        });
        await prisma.productUnitConversion.create({ data: { productId: rollbackIngredient.id, unitId: kilogram.id, factorToBaseUnit: "1000", status: "ACTIVE" } });
        await prisma.inventory.create({ data: { productId: rollbackIngredient.id, quantity: "10000", averageUnitCost: "1" } });
        const rollbackRecipeId = await createRecipe("ACTIVE", rollbackIngredient.id);
        const functionName = `pr005e1_create_rollback_${Date.now()}`;
        const triggerName = `${functionName}_trigger`;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS TRIGGER AS $$ BEGIN IF NEW."productId" = '${rollbackIngredient.id}' THEN RAISE EXCEPTION 'forced production consumption failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "ProductionConsumption" FOR EACH ROW EXECUTE FUNCTION "${functionName}"();`);
        try {
          assert.equal((await request("/productions", {
            method: "POST",
            body: { recipeId: rollbackRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" },
          })).status, 500);
          assert.equal(await prisma.production.count({ where: { recipeId: rollbackRecipeId } }), 0);
        } finally {
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "ProductionConsumption";`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"();`);
        }

        const productionRead = await prisma.permission.findUniqueOrThrow({ where: { code: "production.read" } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: productionRead.id } } });
        assert.equal((await request(`/productions/${created.body.id}`)).status, 403);
        await prisma.rolePermission.create({ data: { roleId: "rbac-role-system-admin", permissionId: productionRead.id } });
        assert.equal((await request(`/productions/${created.body.id}`)).status, 200);

        const productionWrite = await prisma.permission.findUniqueOrThrow({ where: { code: "production.write" } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: productionWrite.id } } });
        assert.equal((await request("/productions", { method: "POST", body: { recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" } })).status, 403);
        await prisma.rolePermission.create({ data: { roleId: "rbac-role-system-admin", permissionId: productionWrite.id } });

        const permissionDraft = await json(await request("/productions", {
          method: "POST",
          body: { recipeId: activeRecipeId, productionDate: "2026-08-23T00:00:00.000Z", plannedQuantity: "1" },
        }));
        assert.equal(permissionDraft.response.status, 201);
        const productionConfirm = await prisma.permission.findUniqueOrThrow({ where: { code: "production.confirm" } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: productionConfirm.id } } });
        assert.equal((await request(`/productions/${permissionDraft.body.id}/confirm`, { method: "POST", body: {} })).status, 403);
        await prisma.rolePermission.create({ data: { roleId: "rbac-role-system-admin", permissionId: productionConfirm.id } });
        assert.equal((await request(`/productions/${permissionDraft.body.id}/confirm`, { method: "POST", body: {} })).status, 201);

        const productionPost = await prisma.permission.findUniqueOrThrow({ where: { code: "production.post" } });
        await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: "rbac-role-system-admin", permissionId: productionPost.id } } });
        assert.equal((await request(`/productions/${permissionDraft.body.id}/post`, { method: "POST", body: { actualQuantity: "1" } })).status, 403);
        await prisma.rolePermission.create({ data: { roleId: "rbac-role-system-admin", permissionId: productionPost.id } });
      } finally {
        if (app !== undefined) await app.close();
        await prisma.$disconnect();
      }
    });
  }
}
