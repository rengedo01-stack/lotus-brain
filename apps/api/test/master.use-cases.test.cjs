const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CreateProductUseCase,
  CreateSupplierUseCase,
  CreateUnitUseCase,
  GetProductUseCase,
  GetSupplierUseCase,
  GetUnitUseCase,
  ListProductsUseCase,
  ListSuppliersUseCase,
  ListUnitsUseCase,
  UpdateProductUseCase,
  UpdateSupplierUseCase,
  UpdateUnitUseCase,
} = require("../dist/modules/master/application/master.use-cases.js");
const {
  MasterConflictError,
  MasterNotFoundError,
  MasterValidationError,
} = require("../dist/modules/master/application/master.errors.js");
const {
  MasterController,
} = require("../dist/modules/master/presentation/master.controller.js");

const makeProduct = (overrides = {}) => ({
  id: "prod-1",
  code: "P-001",
  name: "Product 1",
  description: null,
  baseUnitId: "unit-base",
  inventoryUnitId: "unit-inventory",
  status: "ACTIVE",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-11T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

const makeUnit = (overrides = {}) => ({
  id: "unit-1",
  code: "U-001",
  name: "Unit 1",
  symbol: "u",
  dimension: "COUNT",
  status: "ACTIVE",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-11T00:00:00.000Z"),
  ...overrides,
});

const makeSupplier = (overrides = {}) => ({
  id: "supplier-1",
  code: "S-001",
  name: "Supplier 1",
  status: "ACTIVE",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-11T00:00:00.000Z"),
  deletedAt: null,
  ...overrides,
});

class FakeRepository {
  constructor() {
    this.events = [];
    this.products = [makeProduct({ code: "P-001" }), makeProduct({ id: "prod-2", code: "P-002" })];
    this.units = [makeUnit({ code: "U-001" }), makeUnit({ id: "unit-2", code: "U-002" })];
    this.suppliers = [makeSupplier({ code: "S-001" }), makeSupplier({ id: "supplier-2", code: "S-002" })];
  }

  async createProduct(input) {
    this.events.push(["create-product", input.code]);
    return makeProduct({ code: input.code, name: input.name, description: input.description ?? null, baseUnitId: input.baseUnitId, inventoryUnitId: input.inventoryUnitId, status: input.status ?? "ACTIVE" });
  }

  async getProduct(id) {
    this.events.push(["get-product", id]);
    return this.products.find((item) => item.id === id) ?? null;
  }

  async listProducts(query) {
    this.events.push(["list-products", query.limit, query.offset]);
    return this.products.slice(query.offset, query.offset + query.limit);
  }

  async updateProduct(id, input) {
    this.events.push(["update-product", id]);
    if (id === "missing") return "NOT_FOUND";
    return makeProduct({ id, name: input.name ?? "updated", description: input.description ?? null, status: input.status ?? "ACTIVE" });
  }

  async createUnit(input) {
    this.events.push(["create-unit", input.code]);
    return makeUnit({ code: input.code, name: input.name, symbol: input.symbol, dimension: input.dimension, status: input.status ?? "ACTIVE" });
  }

  async getUnit(id) {
    this.events.push(["get-unit", id]);
    return this.units.find((item) => item.id === id) ?? null;
  }

  async listUnits(query) {
    this.events.push(["list-units", query.limit, query.offset]);
    return this.units.slice(query.offset, query.offset + query.limit);
  }

  async updateUnit(id, input) {
    this.events.push(["update-unit", id]);
    if (id === "missing") return "NOT_FOUND";
    return makeUnit({ id, status: input.status });
  }

  async createSupplier(input) {
    this.events.push(["create-supplier", input.code]);
    return makeSupplier({ code: input.code, name: input.name, status: input.status ?? "ACTIVE" });
  }

  async getSupplier(id) {
    this.events.push(["get-supplier", id]);
    return this.suppliers.find((item) => item.id === id) ?? null;
  }

  async listSuppliers(query) {
    this.events.push(["list-suppliers", query.limit, query.offset]);
    return this.suppliers.slice(query.offset, query.offset + query.limit);
  }

  async updateSupplier(id, input) {
    this.events.push(["update-supplier", id]);
    if (id === "missing") return "NOT_FOUND";
    return makeSupplier({ id, name: input.name ?? "updated", status: input.status ?? "ACTIVE" });
  }
}

const makeController = (repository) => new MasterController(
  { execute: (input) => repository.createProduct(input) },
  { execute: (id) => repository.getProduct(id) },
  { execute: (query) => repository.listProducts(query) },
  { execute: (id, input) => repository.updateProduct(id, input) },
  { execute: (input) => repository.createUnit(input) },
  { execute: (id) => repository.getUnit(id) },
  { execute: (query) => repository.listUnits(query) },
  { execute: (id, input) => repository.updateUnit(id, input) },
  { execute: (input) => repository.createSupplier(input) },
  { execute: (id) => repository.getSupplier(id) },
  { execute: (query) => repository.listSuppliers(query) },
  { execute: (id, input) => repository.updateSupplier(id, input) },
);

test("product use cases support create, get, list, and update", async () => {
  const repository = new FakeRepository();
  const create = await new CreateProductUseCase(repository).execute({
    code: "P-100",
    name: "Product 100",
    baseUnitId: "unit-base",
    inventoryUnitId: "unit-inventory",
  });
  assert.equal(create.code, "P-100");
  assert.equal((await new GetProductUseCase(repository).execute("prod-1")).code, "P-001");
  assert.equal((await new ListProductsUseCase(repository).execute({ limit: 1, offset: 1 }))[0].code, "P-002");
  assert.equal((await new UpdateProductUseCase(repository).execute("prod-1", { name: "Changed" })).name, "Changed");
});

test("unit use cases support create, get, list, and update", async () => {
  const repository = new FakeRepository();
  const create = await new CreateUnitUseCase(repository).execute({
    code: "U-100",
    name: "Unit 100",
    symbol: "u100",
    dimension: "COUNT",
  });
  assert.equal(create.code, "U-100");
  assert.equal((await new GetUnitUseCase(repository).execute("unit-1")).code, "U-001");
  assert.equal((await new ListUnitsUseCase(repository).execute({ limit: 1, offset: 1 }))[0].code, "U-002");
  assert.equal((await new UpdateUnitUseCase(repository).execute("unit-1", { status: "INACTIVE" })).status, "INACTIVE");
});

test("supplier use cases support create, get, list, and update", async () => {
  const repository = new FakeRepository();
  const create = await new CreateSupplierUseCase(repository).execute({
    code: "S-100",
    name: "Supplier 100",
  });
  assert.equal(create.code, "S-100");
  assert.equal((await new GetSupplierUseCase(repository).execute("supplier-1")).code, "S-001");
  assert.equal((await new ListSuppliersUseCase(repository).execute({ limit: 1, offset: 1 }))[0].code, "S-002");
  assert.equal((await new UpdateSupplierUseCase(repository).execute("supplier-1", { name: "Changed" })).name, "Changed");
});

test("use cases map missing records to not found errors", async () => {
  const repository = new FakeRepository();
  await assert.rejects(() => new GetProductUseCase(repository).execute("missing"), MasterNotFoundError);
  await assert.rejects(() => new UpdateProductUseCase(repository).execute("missing", { name: "x" }), MasterNotFoundError);
  await assert.rejects(() => new GetUnitUseCase(repository).execute("missing"), MasterNotFoundError);
  await assert.rejects(() => new UpdateUnitUseCase(repository).execute("missing", { name: "x" }), MasterNotFoundError);
  await assert.rejects(() => new GetSupplierUseCase(repository).execute("missing"), MasterNotFoundError);
  await assert.rejects(() => new UpdateSupplierUseCase(repository).execute("missing", { name: "x" }), MasterNotFoundError);
});

test("controller maps master errors to HTTP exceptions", async () => {
  const controller = new MasterController(
    { execute: async (input) => makeProduct({ code: input.code }) },
    { execute: async () => { throw new MasterNotFoundError("Product", "missing"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
    { execute: async (input) => makeUnit({ code: input.code }) },
    { execute: async () => { throw new MasterNotFoundError("Unit", "missing"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
    { execute: async (input) => makeSupplier({ code: input.code }) },
    { execute: async () => { throw new MasterNotFoundError("Supplier", "missing"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
  );

  const product = await controller.createProduct({
    code: "P-200",
    name: "Product 200",
    baseUnitId: "unit-base",
    inventoryUnitId: "unit-inventory",
  });
  assert.equal(product.code, "P-200");
  await assert.rejects(async () => controller.getProduct("missing"), (error) => error?.name === "NotFoundException");
});

test("controller surfaces master validation and conflict errors", async () => {
  const controller = new MasterController(
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => { throw new MasterValidationError("bad"); } },
    { execute: async () => [] },
    { execute: async () => { throw new MasterConflictError("conflict"); } },
  );

  await assert.rejects(async () => controller.createProduct({ code: "P", name: "P", baseUnitId: "u", inventoryUnitId: "u" }), (error) => error?.name === "UnprocessableEntityException");
  await assert.rejects(async () => controller.updateProduct("id", { name: "x" }), (error) => error?.name === "ConflictException");
});
