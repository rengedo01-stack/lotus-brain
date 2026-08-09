const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PostPurchaseUseCase,
} = require("../dist/modules/purchase/application/post-purchase.use-case.js");
const {
  InvalidPurchaseItemError,
  PurchasePostingConflictError,
} = require("../dist/modules/purchase/application/purchase-posting.errors.js");

const makePurchase = (overrides = {}) => ({
  id: "purchase-1",
  supplierId: "supplier-1",
  purchaseDate: new Date("2026-08-10T00:00:00.000Z"),
  currency: "JPY",
  status: "DRAFT",
  items: [
    {
      id: "item-1",
      productId: "product-1",
      unitId: "unit-1",
      inventoryUnitId: "unit-1",
      lineNumber: 1,
      quantity: "2.500000000",
      unitPrice: "120.000000",
    },
    {
      id: "item-2",
      productId: "product-2",
      unitId: "unit-2",
      inventoryUnitId: "unit-2",
      lineNumber: 2,
      quantity: "1.000000000",
      unitPrice: "80.000000",
    },
  ],
  ...overrides,
});

class FakeRepository {
  constructor(purchase, options = {}) {
    this.purchase = purchase;
    this.options = options;
    this.events = [];
  }

  async withTransaction(operation) {
    const pendingEvents = [];
    const transaction = {
      lockPurchase: async () => this.purchase,
      writePriceEffect: async (_purchase, item) => pendingEvents.push(`price:${item.id}`),
      markPurchasePosted: async () => pendingEvents.push("posted"),
      writeInventoryEffect: async (_purchase, item) => {
        if (this.options.failInventoryFor === item.id) {
          throw new Error("simulated inventory write failure");
        }
        pendingEvents.push(`inventory:${item.id}`);
      },
      appendPostedLog: async () => pendingEvents.push("log"),
    };

    const result = await operation(transaction);
    this.events.push(...pendingEvents);
    return result;
  }
}

test("posts all price and inventory effects in the required order", async () => {
  const repository = new FakeRepository(makePurchase());
  const result = await new PostPurchaseUseCase(repository).execute("purchase-1");

  assert.equal(result.id, "purchase-1");
  assert.equal(result.status, "POSTED");
  assert.ok(result.postedAt instanceof Date);
  assert.deepEqual(repository.events, [
    "price:item-1",
    "price:item-2",
    "posted",
    "inventory:item-1",
    "inventory:item-2",
    "log",
  ]);
});

test("does not commit partial work when a later write fails", async () => {
  const repository = new FakeRepository(makePurchase(), { failInventoryFor: "item-2" });

  await assert.rejects(
    () => new PostPurchaseUseCase(repository).execute("purchase-1"),
    /simulated inventory write failure/,
  );
  assert.deepEqual(repository.events, []);
});

test("rejects an already posted purchase before any write", async () => {
  const repository = new FakeRepository(makePurchase({ status: "POSTED" }));

  await assert.rejects(
    () => new PostPurchaseUseCase(repository).execute("purchase-1"),
    PurchasePostingConflictError,
  );
  assert.deepEqual(repository.events, []);
});

test("rejects a non-inventory-unit purchase item before any write", async () => {
  const purchase = makePurchase({
    items: [{ ...makePurchase().items[0], unitId: "other-unit" }],
  });
  const repository = new FakeRepository(purchase);

  await assert.rejects(
    () => new PostPurchaseUseCase(repository).execute("purchase-1"),
    InvalidPurchaseItemError,
  );
  assert.deepEqual(repository.events, []);
});
