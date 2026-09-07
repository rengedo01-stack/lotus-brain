import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  isAmbiguousProductionPostingError,
  isActiveRecipeList,
  isPostedProductionResult,
  isProduction,
  mergePostedProductionResult,
  productionCreatePayload,
  productionFormFromProduction,
  productionUpdatePayload,
  requestProductionPosting,
  validateActualQuantity,
  validateProductionCreate,
  type ProductionPostingApi,
  type Production,
} from "../lib/productions.ts";

const production: Production = {
  id: "production-1",
  recipe: { id: "recipe-revision-2", rootRecipeId: "recipe-root", revision: 2 },
  productionDate: "2026-08-23T00:00:00.000Z",
  plannedQuantity: "1000000000.123456789",
  actualQuantity: null,
  status: "DRAFT",
  note: null,
  postedAt: null,
  cancelledAt: null,
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  output: { productId: "finished-product", yieldQuantity: "12.500000000", unitId: "unit-kg", conversionFactor: "1.000000000" },
  consumptions: [{
    id: "consumption-1",
    lineNumber: 1,
    productId: "ingredient-product",
    recipeQuantitySnapshot: "2.000000000",
    recipeUnitId: "unit-kg",
    inventoryQuantity: "2.000000000",
    inventoryUnitId: "unit-kg",
    conversionFactorSnapshot: "1.000000000",
    unitCostSnapshot: "0",
    amountSnapshot: "0",
    currency: "JPY",
  }],
};

test("production create and patch payloads preserve decimal strings and patch only E1 allowlisted fields", () => {
  const createPayload = productionCreatePayload({
    ...productionFormFromProduction(production),
    recipeId: "recipe-revision-2",
    note: " planned run ",
  });
  assert.deepEqual(createPayload, {
    recipeId: "recipe-revision-2",
    productionDate: "2026-08-23",
    plannedQuantity: "1000000000.123456789",
    note: "planned run",
  });

  const updatePayload = productionUpdatePayload(productionFormFromProduction(production));
  assert.deepEqual(updatePayload, {
    productionDate: "2026-08-23",
    plannedQuantity: "1000000000.123456789",
    note: null,
  });
  const serialized = JSON.stringify(updatePayload);
  assert.equal(serialized.includes("recipe-revision-2"), false);
  assert.equal(serialized.includes("finished-product"), false);
  assert.equal(serialized.includes("consumption-1"), false);
  assert.equal(serialized.includes("1.000000000"), false);
});

test("production validation accepts decimal strings without number conversion and rejects malformed or zero values", () => {
  assert.deepEqual(validateProductionCreate({
    recipeId: "recipe-1",
    productionDate: "2026-08-23",
    plannedQuantity: "999999999999999.123456789",
    note: "",
  }), {});
  assert.equal(validateActualQuantity("1000000000000000000000.123456789"), undefined);
  assert.equal(validateActualQuantity("0"), "実績生産量は正の10進数で入力してください。");
  assert.equal(validateActualQuantity("01.2"), "実績生産量は正の10進数で入力してください。");
  assert.equal(validateProductionCreate({ recipeId: "", productionDate: "not-a-date", plannedQuantity: "1.1234567890", note: "" }).recipeId, "有効なレシピを入力してください。");
});

test("production and lifecycle response guards require string decimals and exact post result shape", () => {
  assert.equal(isProduction(production), true);
  assert.equal(isProduction({ ...production, plannedQuantity: 1 }), false);
  assert.equal(isProduction({ ...production, output: { ...production.output, conversionFactor: "factor" } }), false);
  assert.equal(isProduction({ ...production, consumptions: [{ ...production.consumptions[0], amountSnapshot: 0 }] }), false);
  const posted = { id: "production-1", status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: "3.000000000" } as const;
  assert.equal(isPostedProductionResult(posted, "production-1"), true);
  assert.equal(isPostedProductionResult({ ...posted, extra: true }, "production-1"), false);
  assert.equal(isPostedProductionResult({ id: "production-1", status: "POSTED", postedAt: posted.postedAt }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, id: "different-production" }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, id: "" }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, status: "CONFIRMED" }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, postedAt: "2026-08-23" }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, postedAt: null }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, actualQuantity: 3 }, "production-1"), false);
  assert.equal(isPostedProductionResult({ ...posted, actualQuantity: "not-a-decimal" }, "production-1"), false);
  assert.equal(isPostedProductionResult([], "production-1"), false);
});

test("production posting uses exact HTTP 200 and its authoritative lifecycle body without a follow-up read", async () => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: ProductionPostingApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { id: production.id, status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: "3" } as T;
    },
  };

  const posted = await requestProductionPosting(api, production, "3");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, `/productions/${production.id}/post`);
  assert.deepEqual(calls[0]?.options, { method: "POST", body: { actualQuantity: "3" }, expectedStatus: 200 });
  assert.equal(posted.status, "POSTED");
  assert.equal(posted.actualQuantity, "3");
  assert.equal(posted.consumptions, production.consumptions);
});

test("production posting rejects unexpected success statuses and malformed JSON", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify({ id: production.id, status: "POSTED", postedAt: "2026-08-23T01:00:00.000Z", actualQuantity: "3" }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductionPosting(createApiClient(), production, "3"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response("not json", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestProductionPosting(createApiClient(), production, "3"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("ambiguous production posting results require explicit reconciliation", () => {
  assert.equal(isAmbiguousProductionPostingError(new ApiError("server", 201)), true);
  assert.equal(isAmbiguousProductionPostingError(new ApiError("network")), true);
  assert.equal(isAmbiguousProductionPostingError(new ApiError("conflict", 409)), true);
  assert.equal(isAmbiguousProductionPostingError(new ApiError("validation", 422)), false);
  assert.equal(isAmbiguousProductionPostingError(new ApiError("forbidden", 403)), false);
  assert.equal(isAmbiguousProductionPostingError(new ApiError("unauthorized", 401)), false);
});

test("a partial post response updates only authoritative lifecycle fields", () => {
  const merged = mergePostedProductionResult(production, {
    id: production.id,
    status: "POSTED",
    postedAt: "2026-08-23T01:00:00.000Z",
    actualQuantity: "3.000000000",
  });
  assert.equal(merged.status, "POSTED");
  assert.equal(merged.actualQuantity, "3.000000000");
  assert.equal(merged.postedAt, "2026-08-23T01:00:00.000Z");
  assert.equal(merged.consumptions, production.consumptions);
  assert.equal(merged.output, production.output);
});

test("only active recipe responses are selectable for production creation", () => {
  const activeRecipe = {
    id: "recipe-1",
    rootRecipeId: "recipe-root",
    name: "Finished good",
    outputProductId: "product-finished",
    yieldQuantity: "1.000000000",
    yieldUnitId: "unit-each",
    status: "ACTIVE",
    revision: 1,
    note: null,
    items: [{ id: "recipe-item-1", productId: "product-input", unitId: "unit-each", quantity: "2.000000000", sortOrder: 1 }],
  };
  assert.equal(isActiveRecipeList([activeRecipe]), true);
  assert.equal(isActiveRecipeList([{ ...activeRecipe, status: "ARCHIVED" }]), false);
  assert.equal(isActiveRecipeList([{ ...activeRecipe, items: [{ ...activeRecipe.items[0], quantity: 2 }] }]), false);
});
