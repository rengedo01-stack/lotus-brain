const test = require("node:test");
const assert = require("node:assert/strict");

const { StocktakeController } = require("../dist/modules/stocktake/presentation/stocktake.controller.js");
const {
  stocktakeListItemResponseSchema,
  stocktakeListPageResponseSchema,
} = require("../dist/modules/stocktake/presentation/stocktake-list-response.schemas.js");

const createdAt = new Date("2026-09-09T00:00:00.000Z");
const stocktake = {
  id: "stocktake-2",
  status: "POSTED",
  startedAt: new Date("2026-09-09T00:05:00.000Z"),
  completedAt: new Date("2026-09-09T01:00:00.000Z"),
  createdAt,
  updatedAt: new Date("2026-09-09T01:00:00.000Z"),
};

function controller(list) {
  return new StocktakeController({}, {}, {}, {}, {}, list);
}

test("stocktake list returns only header lifecycle fields", async () => {
  const received = [];
  const instance = controller({
    execute: async (query) => {
      received.push(query);
      return { items: [stocktake], nextCursor: { createdAt, id: stocktake.id } };
    },
  });
  const page = await instance.list({ limit: 50, status: "POSTED" });
  assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["completedAt", "createdAt", "id", "startedAt", "status", "updatedAt"]);
  assert.equal(JSON.stringify(page.items[0]).match(/product|inventory|quantity|difference|cost|amount|currency|note|item|adjustment/i), null);
  assert.equal(received[0].limit, 50);
  assert.equal(received[0].status, "POSTED");
});

test("stocktake list cursor is canonical, exact, and bound to every filter", async () => {
  const instance = controller({ execute: async () => ({ items: [stocktake], nextCursor: { createdAt, id: stocktake.id } }) });
  const first = await instance.list({
    limit: 1,
    status: "POSTED",
    createdFrom: "2026-09-01T00:00:00.000Z",
    createdTo: "2026-09-30T23:59:59.999Z",
  });
  await instance.list({
    limit: 1,
    status: "POSTED",
    createdFrom: "2026-09-01T00:00:00.000Z",
    createdTo: "2026-09-30T23:59:59.999Z",
    cursor: first.nextCursor,
  });
  await assert.rejects(
    () => instance.list({ limit: 1, status: "DRAFT", cursor: first.nextCursor }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.list({ limit: 1, cursor: "not-a-cursor" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.list({ limit: 1, createdFrom: "2026-09-30T00:00:00.000Z", createdTo: "2026-09-01T00:00:00.000Z" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.list({ limit: 1, createdFrom: "2026-09-01" }),
    (error) => error?.name === "BadRequestException",
  );
});

test("stocktake list Swagger schemas are exact and do not publish item or inventory fields", () => {
  assert.equal(stocktakeListPageResponseSchema.additionalProperties, false);
  assert.equal(stocktakeListItemResponseSchema.additionalProperties, false);
  for (const field of ["note", "items", "productId", "inventoryUnitId", "systemQuantitySnapshot", "countedQuantity", "differenceQuantity", "adjustment", "amount", "cost"]) {
    assert.equal(Object.hasOwn(stocktakeListItemResponseSchema.properties, field), false);
  }
});
