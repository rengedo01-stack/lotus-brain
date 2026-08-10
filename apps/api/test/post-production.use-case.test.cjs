const test = require("node:test");
const assert = require("node:assert/strict");

const { PostProductionUseCase } = require("../dist/modules/production/application/post-production.use-case.js");
const { InvalidProductionPostingError, ProductionPostingConflictError } = require("../dist/modules/production/application/production-posting.errors.js");

const production = {
  id: "production-1", status: "CONFIRMED", outputProductIdSnapshot: "finished", outputUnitIdSnapshot: "kg", yieldQuantitySnapshot: "4",
  consumptions: [{ id: "consumption-1", productId: "material", recipeQuantitySnapshot: "2", recipeUnitId: "kg", inventoryUnitId: "kg", conversionFactorSnapshot: "1" }],
};

class FakeRepository {
  constructor(options = {}) { this.options = options; this.events = []; this.calls = []; }
  async withTransaction(operation) {
    const pending = [];
    const tx = {
      lockProduction: async () => this.options.production ?? production,
      lockInventories: async () => this.options.inventories ?? [
        { id: "finished-inventory", productId: "finished", quantity: "5", averageUnitCost: "1000", inventoryUnitId: "kg" },
        { id: "material-inventory", productId: "material", quantity: "10", averageUnitCost: "600", inventoryUnitId: "kg" },
      ],
      lockProductionStatus: async () => (this.options.status ?? "CONFIRMED"),
      factorToInventory: async () => "1",
      updateConsumptionCost: async (id, recipeQuantity, inventoryQuantity, unitCost, amount) => {
        pending.push("snapshot");
        this.calls.push(["snapshot", id, recipeQuantity, inventoryQuantity, unitCost, amount]);
      },
      markProductionPosted: async (id, actualQuantity, postedAt) => {
        pending.push("posted");
        this.calls.push(["posted", id, actualQuantity, postedAt instanceof Date]);
      },
      updateInventory: async (id, quantity, averageUnitCost) => {
        pending.push("inventory");
        this.calls.push(["inventory", id, quantity, averageUnitCost]);
      },
      createConsumptionHistory: async (consumptionId, inventory, quantity, quantityAfter) => {
        pending.push("consumption-history");
        this.calls.push(["consumption-history", consumptionId, inventory.productId, quantity, quantityAfter]);
      },
      createOutputHistory: async (productionId, inventory, quantity, quantityAfter) => {
        if (this.options.failOutput) throw new Error("output failure");
        pending.push("output-history");
        this.calls.push(["output-history", productionId, inventory.productId, quantity, quantityAfter]);
      },
      appendPostedLog: async (productionId) => {
        pending.push("log");
        this.calls.push(["log", productionId]);
      },
    };
    const result = await operation(tx);
    this.events.push(...pending);
    return result;
  }
}

test("posts a confirmed production with decimal cost and stock effects", async () => {
  const repository = new FakeRepository();
  const result = await new PostProductionUseCase(repository).execute("production-1", "10.000000");
  assert.equal(result.status, "POSTED");
  assert.equal(result.actualQuantity, "10");
  assert.deepEqual(repository.events, ["snapshot", "posted", "inventory", "consumption-history", "inventory", "output-history", "log"]);
});

test("rejects non-positive actual quantity before a transaction", async () => {
  const repository = new FakeRepository();
  await assert.rejects(() => new PostProductionUseCase(repository).execute("production-1", "0"), InvalidProductionPostingError);
  assert.deepEqual(repository.events, []);
});

test("rolls back all pending effects when a later write fails", async () => {
  const repository = new FakeRepository({ failOutput: true });
  await assert.rejects(() => new PostProductionUseCase(repository).execute("production-1", "10"), /output failure/);
  assert.deepEqual(repository.events, []);
});

test("rejects a non-confirmed production", async () => {
  const repository = new FakeRepository({ status: "POSTED" });
  await assert.rejects(() => new PostProductionUseCase(repository).execute("production-1", "10"), ProductionPostingConflictError);
  assert.deepEqual(repository.events, []);
});

test("accumulates repeated product updates before the output receipt", async () => {
  const repository = new FakeRepository({
    production: {
      id: "production-dup",
      status: "CONFIRMED",
      outputProductIdSnapshot: "material",
      outputUnitIdSnapshot: "kg",
      yieldQuantitySnapshot: "2",
      consumptions: [
        { id: "consumption-a", productId: "material", recipeQuantitySnapshot: "1", recipeUnitId: "kg", inventoryUnitId: "kg", conversionFactorSnapshot: "1" },
        { id: "consumption-b", productId: "material", recipeQuantitySnapshot: "1", recipeUnitId: "kg", inventoryUnitId: "kg", conversionFactorSnapshot: "1" },
      ],
    },
    inventories: [{ id: "material-inventory", productId: "material", quantity: "10", averageUnitCost: "600", inventoryUnitId: "kg" }],
  });

  const result = await new PostProductionUseCase(repository).execute("production-dup", "4");
  assert.equal(result.status, "POSTED");
  assert.deepEqual(
    repository.calls.filter(([kind]) => kind === "inventory").map(([, , quantity]) => quantity),
    ["8", "6", "10"],
  );
  assert.deepEqual(
    repository.calls.filter(([kind]) => kind === "consumption-history").map(([, , , , quantityAfter]) => quantityAfter),
    ["8", "6"],
  );
  assert.deepEqual(
    repository.calls.filter(([kind]) => kind === "output-history").map(([, , , , quantityAfter]) => quantityAfter),
    ["10"],
  );
});
