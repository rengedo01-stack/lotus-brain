const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ConfirmProductionUseCase,
  CreateProductionUseCase,
  GetProductionUseCase,
  UpdateProductionDraftUseCase,
} = require("../dist/modules/production/application/production-lifecycle.use-cases.js");
const {
  ProductionLifecycleConflictError,
  ProductionLifecycleNotFoundError,
  ProductionLifecycleValidationError,
} = require("../dist/modules/production/application/production-lifecycle.errors.js");
const { ProductionController } = require("../dist/modules/production/presentation/production.controller.js");
const { REQUIRED_PERMISSIONS_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { Permissions } = require("../dist/modules/authorization/permission.registry.js");

const productionInput = {
  recipeId: "recipe-active-1",
  productionDate: "2026-08-23T00:00:00.000Z",
  plannedQuantity: "10.000000000",
  note: "first batch",
};

const makeProduction = (overrides = {}) => ({
  id: "production-1",
  recipe: { id: "recipe-active-1", rootRecipeId: "recipe-root-1", revision: 2 },
  productionDate: new Date("2026-08-23T00:00:00.000Z"),
  plannedQuantity: "10",
  actualQuantity: null,
  status: "DRAFT",
  note: "first batch",
  postedAt: null,
  cancelledAt: null,
  createdAt: new Date("2026-08-23T00:00:00.000Z"),
  updatedAt: new Date("2026-08-23T00:00:00.000Z"),
  output: { productId: "finished", yieldQuantity: "4", unitId: "unit-output", conversionFactor: "2" },
  consumptions: [{
    id: "consumption-1",
    lineNumber: 0,
    productId: "ingredient",
    recipeQuantitySnapshot: "1.25",
    recipeUnitId: "unit-ingredient",
    inventoryQuantity: "2.5",
    inventoryUnitId: "unit-inventory",
    conversionFactorSnapshot: "2",
    unitCostSnapshot: "0",
    amountSnapshot: "0",
    currency: "JPY",
  }],
  ...overrides,
});

class FakeRepository {
  constructor() {
    this.production = makeProduction();
    this.events = [];
    this.getResult = this.production;
    this.updateResult = this.production;
    this.confirmResult = makeProduction({ status: "CONFIRMED" });
  }

  async create(input) {
    this.events.push(["create", input.recipeId, input.plannedQuantity]);
    return this.production;
  }

  async get(id) {
    this.events.push(["get", id]);
    return id === "missing" ? null : this.getResult;
  }

  async updateDraft(id, input) {
    this.events.push(["update", id, input]);
    return id === "missing" ? "NOT_FOUND" : this.updateResult;
  }

  async confirm(id) {
    this.events.push(["confirm", id]);
    return id === "missing" ? "NOT_FOUND" : this.confirmResult;
  }
}

test("production lifecycle use cases create, expose snapshots, patch allowlisted values, and confirm", async () => {
  const repository = new FakeRepository();
  const create = new CreateProductionUseCase(repository);
  const get = new GetProductionUseCase(repository);
  const update = new UpdateProductionDraftUseCase(repository);
  const confirm = new ConfirmProductionUseCase(repository);

  const created = await create.execute(productionInput);
  assert.deepEqual(created.recipe, { id: "recipe-active-1", rootRecipeId: "recipe-root-1", revision: 2 });
  assert.equal(created.output.conversionFactor, "2");
  assert.equal(created.consumptions[0].conversionFactorSnapshot, "2");
  assert.equal((await get.execute("production-1")).id, "production-1");
  assert.equal((await update.execute("production-1", { plannedQuantity: "12.000000000" })).plannedQuantity, "10");
  assert.equal((await confirm.execute("production-1")).status, "CONFIRMED");
  assert.deepEqual(repository.events, [
    ["create", "recipe-active-1", "10.000000000"],
    ["get", "production-1"],
    ["update", "production-1", { plannedQuantity: "12.000000000" }],
    ["confirm", "production-1"],
  ]);
});

test("production lifecycle maps missing, replay, and empty patch requests safely", async () => {
  const repository = new FakeRepository();
  repository.updateResult = "CONFLICT";
  repository.confirmResult = "CONFLICT";

  await assert.rejects(() => new GetProductionUseCase(repository).execute("missing"), ProductionLifecycleNotFoundError);
  await assert.rejects(() => new UpdateProductionDraftUseCase(repository).execute("production-1", {}), ProductionLifecycleValidationError);
  await assert.rejects(() => new UpdateProductionDraftUseCase(repository).execute("production-1", { note: "changed" }), ProductionLifecycleConflictError);
  await assert.rejects(() => new ConfirmProductionUseCase(repository).execute("production-1"), ProductionLifecycleConflictError);
});

test("production controller maps lifecycle failures and binds each endpoint to the typed permission registry", async () => {
  const controller = new ProductionController(
    { execute: async () => ({ id: "posted" }) },
    { execute: async () => { throw new ProductionLifecycleValidationError("Recipe must be active."); } },
    { execute: async () => { throw new ProductionLifecycleNotFoundError("missing"); } },
    { execute: async () => { throw new ProductionLifecycleConflictError("Production is not editable."); } },
    { execute: async () => ({ ...makeProduction(), status: "CONFIRMED" }) },
  );
  await assert.rejects(() => controller.createProduction(productionInput), (error) => error?.name === "UnprocessableEntityException");
  await assert.rejects(() => controller.getProduction("missing"), (error) => error?.name === "NotFoundException");
  await assert.rejects(() => controller.updateProduction("production-1", { note: "new" }), (error) => error?.name === "ConflictException");

  const permissions = [
    ["createProduction", Permissions.PRODUCTION_WRITE],
    ["getProduction", Permissions.PRODUCTION_READ],
    ["updateProduction", Permissions.PRODUCTION_WRITE],
    ["confirmProduction", Permissions.PRODUCTION_CONFIRM],
    ["postProduction", Permissions.PRODUCTION_POST],
  ];
  for (const [method, permission] of permissions) {
    assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ProductionController.prototype[method]), [permission]);
  }
});
