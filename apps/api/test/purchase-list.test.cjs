const test = require("node:test");
const assert = require("node:assert/strict");

const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");
const {
  purchaseListItemResponseSchema,
  purchaseListPageResponseSchema,
} = require("../dist/modules/purchase/presentation/purchase-response.schemas.js");

const purchaseDate = new Date("2026-09-08T00:00:00.000Z");
const purchase = {
  id: "purchase-2",
  status: "POSTED",
  purchaseDate,
  documentNumber: "PO-002",
  postedAt: new Date("2026-09-08T01:00:00.000Z"),
  cancelledAt: null,
  supplier: { code: "SUP-002", name: "Supplier 2" },
};

function controller(list) {
  return new PurchaseController({}, {}, {}, {}, {}, list);
}

test("purchase list returns only the narrow summary projection with an opaque cursor", async () => {
  const received = [];
  const instance = controller({
    execute: async (query) => {
      received.push(query);
      return { items: [purchase], nextCursor: { purchaseDate, id: purchase.id } };
    },
  });
  const page = await instance.listPurchases({ limit: 50, status: "POSTED" });
  assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["cancelledAt", "documentNumber", "id", "postedAt", "purchaseDate", "status", "supplier"]);
  assert.deepEqual(Object.keys(page.items[0].supplier).sort(), ["code", "name"]);
  assert.equal(typeof page.nextCursor, "string");
  assert.equal(JSON.stringify(page.items[0]).match(/subtotal|tax|total|currency|unitPrice|items|note|PriceHistory|InventoryHistory|source/i), null);
  assert.equal(received[0].limit, 50);
  assert.equal(received[0].status, "POSTED");
});

test("purchase list cursor is exact, filter-bound, and rejects malformed ranges", async () => {
  const instance = controller({ execute: async () => ({ items: [purchase], nextCursor: { purchaseDate, id: purchase.id } }) });
  const first = await instance.listPurchases({
    limit: 1,
    status: "POSTED",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
    supplierCode: "SUP-002",
    documentNumber: "PO-002",
  });
  await instance.listPurchases({
    limit: 1,
    status: "POSTED",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
    supplierCode: "SUP-002",
    documentNumber: "PO-002",
    cursor: first.nextCursor,
  });
  await assert.rejects(
    () => instance.listPurchases({ limit: 1, status: "DRAFT", cursor: first.nextCursor }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listPurchases({ limit: 1, cursor: "not-a-cursor" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listPurchases({ limit: 1, from: "2026-09-30T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }),
    (error) => error?.name === "BadRequestException",
  );
  await assert.rejects(
    () => instance.listPurchases({ limit: 1, from: "2026-09-01" }),
    (error) => error?.name === "BadRequestException",
  );
});

test("purchase list Swagger schemas are exact and contain no financial/detail fields", () => {
  assert.equal(purchaseListPageResponseSchema.additionalProperties, false);
  assert.equal(purchaseListItemResponseSchema.additionalProperties, false);
  assert.equal(purchaseListItemResponseSchema.properties.supplier.additionalProperties, false);
  for (const field of ["subtotal", "tax", "total", "currency", "items", "note", "averageUnitCost", "sourcePurchaseItemId"]) {
    assert.equal(Object.hasOwn(purchaseListItemResponseSchema.properties, field), false);
  }
});
