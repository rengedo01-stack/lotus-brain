const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ActivateRecipeUseCase,
  ArchiveRecipeUseCase,
  CreateRecipeDraftUseCase,
  CreateRecipeRevisionUseCase,
  GetRecipeUseCase,
  ListRecipesUseCase,
  UpdateRecipeDraftUseCase,
} = require("../dist/modules/recipe/application/recipe.use-cases.js");
const {
  RecipeConflictError,
  RecipeNotFoundError,
  RecipeValidationError,
} = require("../dist/modules/recipe/application/recipe.errors.js");
const { RecipeController } = require("../dist/modules/recipe/presentation/recipe.controller.js");

const recipeInput = {
  name: "Bread",
  outputProductId: "product-bread",
  yieldQuantity: "4.000000000",
  yieldUnitId: "unit-each",
  note: "daily batch",
  items: [{ productId: "product-flour", unitId: "unit-kg", quantity: "1.250000000" }],
};

const makeRecipe = (overrides = {}) => ({
  id: "recipe-1",
  rootRecipeId: "recipe-1",
  name: "Bread",
  outputProductId: "product-bread",
  yieldQuantity: "4",
  yieldUnitId: "unit-each",
  status: "DRAFT",
  revision: 1,
  note: "daily batch",
  createdAt: new Date("2026-08-22T00:00:00.000Z"),
  updatedAt: new Date("2026-08-22T00:00:00.000Z"),
  items: [{ id: "recipe-item-1", productId: "product-flour", unitId: "unit-kg", quantity: "1.25", sortOrder: 0 }],
  ...overrides,
});

class FakeRepository {
  constructor() {
    this.events = [];
    this.recipe = makeRecipe();
    this.updateResult = this.recipe;
    this.activateResult = makeRecipe({ status: "ACTIVE" });
    this.archiveResult = makeRecipe({ status: "ARCHIVED" });
    this.revisionResult = makeRecipe({ id: "recipe-2", status: "DRAFT", revision: 2 });
  }

  async createDraft(input) {
    this.events.push(["create", input.yieldQuantity, input.items[0].quantity]);
    return makeRecipe({ name: input.name, yieldQuantity: "4", items: [{ ...this.recipe.items[0], quantity: "1.25" }] });
  }

  async get(id) {
    this.events.push(["get", id]);
    return id === "missing" ? null : this.recipe;
  }

  async list(query) {
    this.events.push(["list", query.limit, query.offset, query.status]);
    return [this.recipe];
  }

  async updateDraft(id, input) {
    this.events.push(["update", id, input.yieldQuantity]);
    return id === "missing" ? "NOT_FOUND" : this.updateResult;
  }

  async activate(id) {
    this.events.push(["activate", id]);
    return id === "missing" ? "NOT_FOUND" : this.activateResult;
  }

  async archive(id) {
    this.events.push(["archive", id]);
    return id === "missing" ? "NOT_FOUND" : this.archiveResult;
  }

  async createRevision(id) {
    this.events.push(["revision", id]);
    return id === "missing" ? "NOT_FOUND" : this.revisionResult;
  }
}

function makeController(repository) {
  return new RecipeController(
    { execute: (input) => repository.createDraft(input) },
    { execute: (id) => repository.get(id) },
    { execute: (query) => repository.list(query) },
    { execute: (id, input) => repository.updateDraft(id, input) },
    { execute: (id) => repository.activate(id) },
    { execute: (id) => repository.archive(id) },
    { execute: (id) => repository.createRevision(id) },
  );
}

test("recipe use cases preserve decimal strings and expose bounded active reads", async () => {
  const repository = new FakeRepository();
  const created = await new CreateRecipeDraftUseCase(repository).execute(recipeInput);
  assert.equal(created.yieldQuantity, "4");
  assert.equal(created.items[0].quantity, "1.25");
  assert.equal((await new GetRecipeUseCase(repository).execute("recipe-1")).id, "recipe-1");
  assert.equal((await new ListRecipesUseCase(repository).execute({ limit: 50, offset: 0, status: "ACTIVE" })).length, 1);
  assert.deepEqual(repository.events, [
    ["create", "4.000000000", "1.250000000"],
    ["get", "recipe-1"],
    ["list", 50, 0, "ACTIVE"],
  ]);
});

test("recipe use cases enforce not found and lifecycle conflicts", async () => {
  const repository = new FakeRepository();
  repository.updateResult = "CONFLICT";
  repository.activateResult = "CONFLICT";
  repository.archiveResult = "CONFLICT";
  repository.revisionResult = "CONFLICT";

  await assert.rejects(() => new GetRecipeUseCase(repository).execute("missing"), RecipeNotFoundError);
  await assert.rejects(() => new UpdateRecipeDraftUseCase(repository).execute("recipe-1", recipeInput), RecipeConflictError);
  await assert.rejects(() => new ActivateRecipeUseCase(repository).execute("recipe-1"), RecipeConflictError);
  await assert.rejects(() => new ArchiveRecipeUseCase(repository).execute("recipe-1"), RecipeConflictError);
  await assert.rejects(() => new CreateRecipeRevisionUseCase(repository).execute("recipe-1"), RecipeConflictError);
});

test("recipe controller maps safe domain errors without database detail", async () => {
  const controller = new RecipeController(
    { execute: async () => { throw new RecipeValidationError("Recipe Product must be active."); } },
    { execute: async () => { throw new RecipeNotFoundError(); } },
    { execute: async () => [] },
    { execute: async () => { throw new RecipeConflictError("Only an unreferenced DRAFT Recipe can be structurally updated."); } },
    { execute: async () => makeRecipe({ status: "ACTIVE" }) },
    { execute: async () => makeRecipe({ status: "ARCHIVED" }) },
    { execute: async () => makeRecipe({ id: "recipe-2", revision: 2 }) },
  );

  await assert.rejects(async () => controller.createRecipe(recipeInput), (error) => error?.name === "UnprocessableEntityException");
  await assert.rejects(async () => controller.getRecipe("missing"), (error) => error?.name === "NotFoundException");
  await assert.rejects(async () => controller.updateRecipe("recipe-1", recipeInput), (error) => error?.name === "ConflictException");
});

test("recipe controller routes lifecycle mutations through the supplied use cases", async () => {
  const repository = new FakeRepository();
  const controller = makeController(repository);
  assert.equal((await controller.createRecipe(recipeInput)).status, "DRAFT");
  assert.equal((await controller.activateRecipe("recipe-1")).status, "ACTIVE");
  assert.equal((await controller.archiveRecipe("recipe-1")).status, "ARCHIVED");
  assert.equal((await controller.createRevision("recipe-1")).revision, 2);
});
