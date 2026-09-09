const test = require("node:test");
const assert = require("node:assert/strict");

const { InventoryController } = require("../dist/modules/inventory/presentation/inventory.controller.js");
const { InventoryReadNotFoundError } = require("../dist/modules/inventory/application/inventory-read.errors.js");
const { ListInventoryHistoryUseCase } = require("../dist/modules/inventory/application/inventory-read.use-cases.js");
const { currentInventoryPageResponseSchema, inventoryHistoryPageResponseSchema, inventorySupplyContextPageResponseSchema } = require("../dist/modules/inventory/presentation/inventory-response.schemas.js");

const currentInventory = {
  product: { id: "product-1", code: "P-001", name: "Product", status: "ACTIVE", isDeleted: false },
  quantity: "123456789.123456789",
  inventoryUnit: { code: "EA", name: "Each", symbol: "ea" },
  updatedAt: new Date("2026-09-08T00:00:00.000Z"),
};
const history = { id: "history-1", type: "RECEIPT", quantityDelta: "1.000000000", quantityAfter: "123456790.123456789", occurredAt: new Date("2026-09-08T00:00:00.000Z"), inventoryUnit: currentInventory.inventoryUnit };
const supplyContext = {
  product: { id: "product-1", code: "P-001", name: "Product" },
  inventoryUnit: currentInventory.inventoryUnit,
  currentQuantity: "123456789.123456789",
  draftPurchaseQuantity: "2.000000000",
  confirmedPurchaseQuantity: "3.000000000",
};

test("inventory controller returns opaque page cursors and does not add cost or source fields", async () => {
  const controller = new InventoryController(
    { execute: async () => ({ items: [currentInventory], nextCursor: { productCode: "P-001", productId: "product-1" } }) },
    { execute: async () => ({ currentInventory, items: [history], nextCursor: null }) },
    { execute: async () => ({ items: [supplyContext], nextCursor: { productCode: "P-001", productId: "product-1" } }) },
  );
  const page = await controller.listCurrentInventory({ limit: 50 });
  assert.deepEqual(Object.keys(page).sort(), ["items", "nextCursor"]);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["inventoryUnit", "product", "quantity", "updatedAt"]);
  assert.equal(typeof page.nextCursor, "string");
  assert.equal(JSON.stringify(page).includes("averageUnitCost"), false);
  assert.equal(JSON.stringify(page).includes("sourcePurchaseItemId"), false);
  const supplyPage = await controller.listSupplyContext({ limit: 50 });
  assert.deepEqual(Object.keys(supplyPage).sort(), ["items", "nextCursor"]);
  assert.deepEqual(Object.keys(supplyPage.items[0]).sort(), ["confirmedPurchaseQuantity", "currentQuantity", "draftPurchaseQuantity", "inventoryUnit", "product"]);
  assert.equal(JSON.stringify(supplyPage).match(/price|supplier|cost|available|expected/i), null);
  const historyPage = await controller.listInventoryHistory("product-1", { limit: 50 });
  assert.deepEqual(Object.keys(historyPage).sort(), ["currentInventory", "items", "nextCursor"]);
  assert.deepEqual(Object.keys(historyPage.items[0]).sort(), ["id", "inventoryUnit", "occurredAt", "quantityAfter", "quantityDelta", "type"]);
});

test("inventory controller rejects malformed cursors and inverted canonical UTC ranges as 400", async () => {
  const controller = new InventoryController({ execute: async () => ({ items: [], nextCursor: null }) }, { execute: async () => ({ currentInventory, items: [], nextCursor: null }) }, { execute: async () => ({ items: [], nextCursor: null }) });
  await assert.rejects(() => controller.listCurrentInventory({ limit: 50, cursor: "not-a-cursor" }), (error) => error?.name === "BadRequestException");
  await assert.rejects(() => controller.listInventoryHistory("product-1", { limit: 50, from: "2026-09-09T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" }), (error) => error?.name === "BadRequestException");
  await assert.rejects(() => controller.listInventoryHistory("product-1", { limit: 50, from: "2026-09-08" }), (error) => error?.name === "BadRequestException");
});

test("inventory history requires an existing Inventory row rather than inferring zero", async () => {
  const useCase = new ListInventoryHistoryUseCase({ listInventoryHistory: async () => null });
  await assert.rejects(() => useCase.execute({ productId: "no-inventory", limit: 50 }), InventoryReadNotFoundError);
});

test("inventory Swagger schemas are strict and disclose no financial or source document fields", () => {
  assert.equal(currentInventoryPageResponseSchema.additionalProperties, false);
  assert.equal(inventoryHistoryPageResponseSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(currentInventoryPageResponseSchema.properties.items.items.properties, "averageUnitCost"), false);
  assert.equal(Object.hasOwn(inventoryHistoryPageResponseSchema.properties.items.items.properties, "sourcePurchaseItemId"), false);
  assert.equal(inventorySupplyContextPageResponseSchema.additionalProperties, false);
  assert.equal(Object.hasOwn(inventorySupplyContextPageResponseSchema.properties.items.items.properties, "supplier"), false);
  assert.equal(Object.hasOwn(inventorySupplyContextPageResponseSchema.properties.items.items.properties, "price"), false);
  assert.equal(Object.hasOwn(inventorySupplyContextPageResponseSchema.properties.items.items.properties, "availableQuantity"), false);
});
