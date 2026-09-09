const test = require("node:test");
const assert = require("node:assert/strict");

const { ProductionController } = require("../dist/modules/production/presentation/production.controller.js");
const {
  productionListItemResponseSchema,
  productionListPageResponseSchema,
} = require("../dist/modules/production/presentation/production-response.schemas.js");

const productionDate = new Date("2026-09-09T00:00:00.000Z");
const production = {
  id: "production-2",
  status: "POSTED",
  productionDate,
  outputProductIdSnapshot: "product-output-2",
  recipe: { id: "recipe-2", rootRecipeId: "recipe-root-2", revision: 3 },
  postedAt: new Date("2026-09-09T01:00:00.000Z"),
  cancelledAt: null,
};

function controller(list) {
  return new ProductionController({}, {}, {}, {}, {}, list);
}

test("production list returns only Production-owned operational identifiers and lifecycle fields", async () => {
  const received = [];
  const instance = controller({
    execute: async (query) => {
      received.push(query);
      return { items: [production], nextCursor: { productionDate, id: production.id } };
    },
  });
  const page = await instance.listProductions({ limit: 50, status: "POSTED" });
  assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["cancelledAt", "id", "outputProductIdSnapshot", "postedAt", "productionDate", "recipe", "status"]);
  assert.deepEqual(Object.keys(page.items[0].recipe).sort(), ["id", "revision", "rootRecipeId"]);
  assert.equal(JSON.stringify(page.items[0]).match(/productCode|productName|recipeName|master|amount|cost|currency|consumptions|note|InventoryHistory|PriceHistory/i), null);
  assert.equal(Object.hasOwn(page.items[0], "confirmedAt"), false);
  assert.equal(received[0].limit, 50);
  assert.equal(received[0].status, "POSTED");
});

test("production list cursor is canonical, exact, and bound to every filter", async () => {
  const instance = controller({ execute: async () => ({ items: [production], nextCursor: { productionDate, id: production.id } }) });
  const first = await instance.listProductions({
    limit: 1,
    status: "POSTED",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
    recipeId: "recipe-2",
    outputProductIdSnapshot: "product-output-2",
  });
  await instance.listProductions({
    limit: 1,
    status: "POSTED",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
    recipeId: "recipe-2",
    outputProductIdSnapshot: "product-output-2",
    cursor: first.nextCursor,
  });
  await assert.rejects(
    () => instance.listProductions({ limit: 1, recipeId: "other-recipe", cursor: first.nextCursor }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listProductions({ limit: 1, cursor: "not-a-cursor" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listProductions({ limit: 1, from: "2026-09-30T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listProductions({ limit: 1, from: "2026-09-01" }),
    (error) => error?.name === "BadRequestException",
  );
});

test("production list Swagger schemas are exact and do not publish master or costing fields", () => {
  assert.equal(productionListPageResponseSchema.additionalProperties, false);
  assert.equal(productionListItemResponseSchema.additionalProperties, false);
  assert.equal(productionListItemResponseSchema.properties.recipe.additionalProperties, false);
  for (const field of ["confirmedAt", "productCode", "productName", "recipeName", "consumptions", "note", "actualQuantity", "plannedQuantity", "currency", "amountSnapshot"]) {
    assert.equal(Object.hasOwn(productionListItemResponseSchema.properties, field), false);
  }
});
