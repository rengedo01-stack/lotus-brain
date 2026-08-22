const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ConfirmStocktakeUseCase,
  CreateStocktakeUseCase,
  GetStocktakeUseCase,
  PostStocktakeUseCase,
  UpdateStocktakeUseCase,
} = require("../dist/modules/stocktake/application/stocktake.use-cases.js");
const {
  InvalidStocktakeError,
  StocktakeConflictError,
  StocktakeNotFoundError,
} = require("../dist/modules/stocktake/application/stocktake.errors.js");
const { StocktakeController } = require("../dist/modules/stocktake/presentation/stocktake.controller.js");
const { REQUIRED_PERMISSIONS_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { Permissions } = require("../dist/modules/authorization/permission.registry.js");

const makeStocktake = (overrides = {}) => ({
  id: "stocktake-1",
  status: "DRAFT",
  startedAt: null,
  completedAt: null,
  note: "note",
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  items: [
    {
      id: "item-1",
      productId: "product-a",
      inventoryUnitId: "unit-a",
      systemQuantitySnapshot: "10.000000000",
      countedQuantity: "8.000000000",
      differenceQuantity: "-2.000000000",
      note: null,
    },
    {
      id: "item-2",
      productId: "product-b",
      inventoryUnitId: "unit-b",
      systemQuantitySnapshot: "5.000000000",
      countedQuantity: "6.000000000",
      differenceQuantity: "1.000000000",
      note: null,
    },
  ],
  ...overrides,
});

class FakeRepository {
  constructor(stocktake, options = {}) {
    this.stocktake = stocktake;
    this.options = options;
    this.events = [];
  }

  async create(input) {
    this.events.push(["create", input.items.length]);
    return this.stocktake;
  }

  async get(id) {
    this.events.push(["get", id]);
    return this.options.getResult ?? this.stocktake;
  }

  async updateDraft(id, input) {
    this.events.push(["update", id, input.items.length]);
    return this.options.updateResult ?? this.stocktake;
  }

  async confirm(id) {
    this.events.push(["confirm", id]);
    return this.options.confirmResult ?? this.stocktake;
  }

  async withTransaction(operation) {
    const calls = [];
    const tx = {
      lockStocktakeItems: async (stocktakeId) => {
        calls.push(["lock-items", stocktakeId]);
        return this.options.lockedItems ?? this.stocktake.items;
      },
      lockInventories: async (productIds) => {
        calls.push(["lock-inventories", productIds.slice()]);
        return this.options.inventories ?? [
          { id: "inventory-a", productId: "product-a", quantity: "10.000000000", averageUnitCost: "1000.000000", inventoryUnitId: "unit-a" },
          { id: "inventory-b", productId: "product-b", quantity: "5.000000000", averageUnitCost: "600.000000", inventoryUnitId: "unit-b" },
        ];
      },
      lockStocktake: async (stocktakeId) => {
        calls.push(["lock-stocktake", stocktakeId]);
        return this.options.lockedStocktake ?? this.stocktake;
      },
      createAdjustment: async (stocktakeId, postedAt) => {
        calls.push(["create-adjustment", stocktakeId, postedAt instanceof Date]);
        return "adjustment-1";
      },
      createAdjustmentItems: async (_adjustmentId, items) => {
        calls.push(["create-adjustment-items", items.map((item) => item.quantityDelta)]);
        return items.map((item) => ({ stocktakeItemId: item.stocktakeItemId, adjustmentItemId: `adjustment-${item.stocktakeItemId}` }));
      },
      updateInventories: async (updates) => {
        calls.push(["update-inventories", updates.map((item) => item.quantity)]);
      },
      markStocktakePosted: async (stocktakeId, postedAt) => {
        calls.push(["mark-posted", stocktakeId, postedAt instanceof Date]);
      },
      createInventoryHistories: async (entries) => {
        calls.push(["create-histories", entries.map((item) => item.quantityAfter)]);
      },
    };

    const result = await operation(tx);
    this.events.push(...calls);
    return result;
  }
}

test("creates a stocktake draft with snapshots", async () => {
  const repository = new FakeRepository(makeStocktake());
  const result = await new CreateStocktakeUseCase(repository).execute({ items: [{ productId: "product-a", countedQuantity: "8" }] });
  assert.equal(result.id, "stocktake-1");
  assert.deepEqual(repository.events, [["create", 1]]);
});

test("rejects missing stocktake on get", async () => {
  const repository = new FakeRepository(makeStocktake(), { getResult: null });
  repository.get = async () => null;
  await assert.rejects(() => new GetStocktakeUseCase(repository).execute("missing"), StocktakeNotFoundError);
});

test("updates and confirms a draft stocktake", async () => {
  const repository = new FakeRepository(makeStocktake());
  await new UpdateStocktakeUseCase(repository).execute("stocktake-1", { items: [{ productId: "product-a" }] });
  await new ConfirmStocktakeUseCase(repository).execute("stocktake-1");
  assert.deepEqual(repository.events, [
    ["update", "stocktake-1", 1],
    ["confirm", "stocktake-1"],
  ]);
});

test("posts a confirmed stocktake with aggregated adjustments", async () => {
  const repository = new FakeRepository(makeStocktake({ status: "CONFIRMED" }));
  const result = await new PostStocktakeUseCase(repository).execute("stocktake-1");
  assert.equal(result.status, "POSTED");
  assert.deepEqual(repository.events, [
    ["lock-items", "stocktake-1"],
    ["lock-inventories", ["product-a", "product-b"]],
    ["lock-stocktake", "stocktake-1"],
    ["create-adjustment", "stocktake-1", true],
    ["create-adjustment-items", ["-2", "1"]],
    ["update-inventories", ["8", "6"]],
    ["mark-posted", "stocktake-1", true],
    ["create-histories", ["8", "6"]],
  ]);
});

test("rejects posting a non-confirmed stocktake before any side effect", async () => {
  const repository = new FakeRepository(makeStocktake({ status: "DRAFT" }));
  await assert.rejects(() => new PostStocktakeUseCase(repository).execute("stocktake-1"), StocktakeConflictError);
  assert.deepEqual(repository.events, []);
});

test("rejects posting a stocktake without counted quantities", async () => {
  const repository = new FakeRepository(makeStocktake({
    status: "CONFIRMED",
    items: [{ ...makeStocktake().items[0], countedQuantity: null }],
  }));
  await assert.rejects(() => new PostStocktakeUseCase(repository).execute("stocktake-1"), InvalidStocktakeError);
  assert.deepEqual(repository.events, []);
});

test("stocktake API routes bind every read or mutation to the existing permission registry", () => {
  const assertions = [
    ["create", Permissions.STOCKTAKE_WRITE],
    ["get", Permissions.STOCKTAKE_READ],
    ["update", Permissions.STOCKTAKE_WRITE],
    ["confirm", Permissions.STOCKTAKE_CONFIRM],
    ["post", Permissions.STOCKTAKE_POST],
  ];
  for (const [methodName, permission] of assertions) {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, StocktakeController.prototype[methodName]),
      [permission],
    );
  }
});
