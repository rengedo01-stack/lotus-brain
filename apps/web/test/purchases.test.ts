import assert from "node:assert/strict";
import test from "node:test";
import {
  isAmbiguousPurchasePostingError,
  isPostedPurchaseResult,
  isPurchase,
  mergePostedPurchaseResult,
  purchaseFormFromPurchase,
  purchasePayload,
  requestPurchasePosting,
  validatePurchaseForm,
  type PostedPurchaseResult,
  type PurchasePostingApi,
  type Purchase,
} from "../lib/purchases.ts";
import { ApiError, createApiClient } from "../lib/api-client.ts";

const purchase: Purchase = {
  id: "purchase-1",
  supplier: { id: "supplier-1", code: "SUP-001", name: "仕入先" },
  status: "DRAFT",
  purchaseDate: "2026-08-21T00:00:00.000Z",
  documentNumber: null,
  note: null,
  subtotal: "123456789012.123456",
  tax: "0",
  total: "123456789012.123456",
  postedAt: null,
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  items: [{
    id: "server-line-id",
    lineNumber: 1,
    productId: "product-1",
    unitId: "unit-1",
    quantity: "123456789.123456789",
    unitPrice: "987654321.123456",
    taxRate: "0.1",
    lineAmount: "121932631234567900.000000",
  }],
};

test("purchase create/update payload preserves decimal strings and excludes UI/server item identity", () => {
  const form = purchaseFormFromPurchase(purchase);
  const payload = purchasePayload(form);

  assert.deepEqual(payload.items, [{
    productId: "product-1",
    unitId: "unit-1",
    quantity: "123456789.123456789",
    unitPrice: "987654321.123456",
    taxRate: "0.1",
  }]);
  assert.equal(JSON.stringify(payload).includes("server-line-id"), false);
  assert.equal(JSON.stringify(payload).includes("purchase-line-1"), false);
});

test("purchase form validation rejects zero quantity and tax rates above one without numeric conversion", () => {
  const form = purchaseFormFromPurchase(purchase);
  form.items[0] = { ...form.items[0], quantity: "0.000", taxRate: "1.0001" };

  const errors = validatePurchaseForm(form);
  assert.equal(errors["items.purchase-line-1.quantity"], "数量は0より大きい値を入力してください。");
  assert.equal(errors["items.purchase-line-1.taxRate"], "税率は0から1までの値を入力してください。");
  assert.equal(validatePurchaseForm({ ...form, purchaseDate: "2026/08/21" }).purchaseDate, "仕入日は YYYY-MM-DD 形式で入力してください。");
});

test("purchase response guards reject malformed lifecycle payloads", () => {
  assert.equal(isPurchase(purchase), true);
  assert.equal(isPurchase({ ...purchase, status: "SAVED" }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], quantity: 1 }] }), false);
});

test("purchase posting response requires the exact authoritative lifecycle contract", () => {
  const posted: PostedPurchaseResult = { id: purchase.id, status: "POSTED", postedAt: "2026-08-21T01:02:03.000Z" };
  assert.equal(isPostedPurchaseResult(posted, purchase.id), true);
  assert.equal(isPostedPurchaseResult({ ...posted, extra: true }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ id: purchase.id, status: "POSTED" }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ ...posted, id: "different-purchase" }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ ...posted, id: 1 }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ ...posted, status: "CONFIRMED" }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ ...posted, postedAt: "2026-08-21" }, purchase.id), false);
  assert.equal(isPostedPurchaseResult({ ...posted, postedAt: null }, purchase.id), false);
  assert.equal(isPostedPurchaseResult([], purchase.id), false);
  assert.equal(isPostedPurchaseResult("POSTED", purchase.id), false);

  const merged = mergePostedPurchaseResult(purchase, posted);
  assert.equal(merged.status, "POSTED");
  assert.equal(merged.postedAt, posted.postedAt);
  assert.equal(merged.items, purchase.items);
  assert.equal(merged.total, purchase.total);
});

test("purchase posting uses the exact 200 response as lifecycle authority without a follow-up read", async () => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: PurchasePostingApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { id: purchase.id, status: "POSTED", postedAt: "2026-08-21T01:02:03.000Z" } as T;
    },
  };

  const posted = await requestPurchasePosting(api, purchase);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, `/purchases/${purchase.id}/post`);
  assert.deepEqual(calls[0]?.options, { method: "POST", expectedStatus: 200 });
  assert.equal(posted.status, "POSTED");
  assert.equal(posted.postedAt, "2026-08-21T01:02:03.000Z");
});

test("purchase posting rejects unexpected success statuses and malformed completion bodies", async (t) => {
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
        : new Response(JSON.stringify({ id: purchase.id, status: "POSTED", postedAt: "2026-08-21T01:02:03.000Z" }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchasePosting(createApiClient(), purchase),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response("not json", { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchasePosting(createApiClient(), purchase),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("ambiguous purchase posting results require explicit reconciliation rather than a normal repost", () => {
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("server", 201)), true);
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("network")), true);
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("conflict", 409)), true);
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("validation", 422)), false);
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("forbidden", 403)), false);
  assert.equal(isAmbiguousPurchasePostingError(new ApiError("unauthorized", 401)), false);
});
