const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ConfirmPurchaseUseCase,
  GetPurchaseUseCase,
  UpdatePurchaseDraftUseCase,
} = require("../dist/modules/purchase/application/purchase-draft.use-cases.js");
const {
  PurchaseDraftConflictError,
  PurchaseDraftNotFoundError,
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
