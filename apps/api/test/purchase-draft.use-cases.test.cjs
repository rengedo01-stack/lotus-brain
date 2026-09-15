const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ConfirmPurchaseUseCase,
  CancelPurchaseUseCase,
  GetPurchaseUseCase,
  UpdatePurchaseDraftUseCase,
} = require("../dist/modules/purchase/application/purchase-draft.use-cases.js");
const {
  PurchaseDraftConflictError,
  PurchaseDraftNotFoundError,
  PurchaseDraftForbiddenError,
  PurchaseDraftValidationError,
} = require("../dist/modules/purchase/application/purchase-draft.errors.js");

test("update rejects a non-draft purchase", async () => {
  const useCase = new UpdatePurchaseDraftUseCase({ updateDraft: async () => "CONFLICT" });
  await assert.rejects(() => useCase.execute("purchase", {}), PurchaseDraftConflictError);
});

test("confirm maps not found and conflict states", async () => {
  await assert.rejects(
    () => new ConfirmPurchaseUseCase({ confirm: async () => "NOT_FOUND" }).execute("missing"),
    PurchaseDraftNotFoundError,
  );
  await assert.rejects(
    () => new ConfirmPurchaseUseCase({ confirm: async () => "CONFLICT" }).execute("confirmed"),
    PurchaseDraftConflictError,
  );
});

test("get maps a missing purchase", async () => {
  await assert.rejects(
    () => new GetPurchaseUseCase({ get: async () => null }).execute("missing"),
    PurchaseDraftNotFoundError,
  );
});

test("cancel normalizes the required reason and maps locked lifecycle outcomes", async () => {
  const calls = [];
  const result = await new CancelPurchaseUseCase({
    cancel: async (...args) => {
      calls.push(args);
      return { id: "purchase", status: "CANCELLED", cancelledAt: new Date(), cancellationReason: args[1] };
    },
  }).execute("purchase", "  supplier withdrew  ", "actor");
  assert.equal(result.status, "CANCELLED");
  assert.deepEqual(calls, [["purchase", "supplier withdrew", "actor"]]);
  await assert.rejects(
    () => new CancelPurchaseUseCase({ cancel: async () => "FORBIDDEN" }).execute("purchase", "reason", "actor"),
    PurchaseDraftForbiddenError,
  );
  await assert.rejects(
    () => new CancelPurchaseUseCase({ cancel: async () => "CONFLICT" }).execute("purchase", "reason", "actor"),
    PurchaseDraftConflictError,
  );
  await assert.rejects(
    () => new CancelPurchaseUseCase({ cancel: async () => "NOT_FOUND" }).execute("purchase", "reason", "actor"),
    PurchaseDraftNotFoundError,
  );
  await assert.rejects(
    () => new CancelPurchaseUseCase({ cancel: async () => { throw new Error("must not run"); } }).execute("purchase", " \n ", "actor"),
    PurchaseDraftValidationError,
  );
  await assert.rejects(
    () => new CancelPurchaseUseCase({ cancel: async () => { throw new Error("must not run"); } }).execute("purchase", "x".repeat(10_001), "actor"),
    PurchaseDraftValidationError,
  );
});
