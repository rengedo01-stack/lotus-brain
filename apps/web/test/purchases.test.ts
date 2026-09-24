import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmPurchaseDraft,
  canExecutePurchaseReversal,
  canSubmitPurchaseReversal,
  canStartPurchaseReversal,
  completePurchaseReversal,
  createPurchaseReversalRequest,
  isAmbiguousPurchaseCancellationError,
  isCancelledPurchaseResult,
  createPurchaseDraftFromRecommendation,
  isRecommendationPurchaseHandoffLineageResponse,
  isPurchaseHandoffLineageResponse,
  createPurchaseDraft,
  isAmbiguousPurchasePostingError,
  isAmbiguousPurchaseReversalError,
  isPurchaseReversalExecution,
  isPurchaseReversalAuditResponse,
  isPurchaseReversalPreview,
  isPurchaseReversalRequest,
  isPostedPurchaseResult,
  isPurchase,
  isCanonicalUtcTimestamp,
  isPurchaseListPage,
  mergePostedPurchaseResult,
  mergeCancelledPurchaseResult,
  purchaseListPath,
  purchaseFormFromPurchase,
  purchasePayload,
  requestPurchaseList,
  requestPurchaseDetail,
  requestRecommendationPurchaseHandoffLineage,
  requestPurchaseHandoffLineage,
  type PurchaseListApi,
  requestPurchasePosting,
  requestPurchaseCancellation,
  requestPurchaseReversal,
  requestPurchaseReversalAudit,
  requestPurchaseReversalPreview,
  settlePurchaseReversalPreview,
  startPurchaseReversalPreview,
  markPurchaseReversalUnknown,
  updatePurchaseDraft,
  validatePurchaseForm,
  type PostedPurchaseResult,
  type CancelledPurchaseResult,
  type PurchaseCancellationApi,
  type PurchasePostingApi,
  type PurchaseReversalApi,
  type PurchaseReversalExecution,
  type PurchaseReversalAudit,
  type PurchaseReversalAuditApi,
  type PurchaseReversalPreview,
  type PurchaseReversalWorkflowState,
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
  cancelledAt: null,
  cancellationReason: null,
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
    lineAmount: "99999999999999.999999",
  }],
};

const purchaseListPage = {
  items: [{
    id: "purchase-list-1",
    status: "POSTED",
    purchaseDate: "2026-08-21T00:00:00.000Z",
    documentNumber: "PO-001",
    postedAt: "2026-08-21T01:02:03.000Z",
    cancelledAt: null,
    supplier: { code: "SUP-001", name: "仕入先" },
    correction: null,
  }],
  nextCursor: "opaque-cursor",
};

const handoffLineage = {
  handoff: {
    sourceRecommendationId: "recommendation-1",
    createdAt: "2026-09-14T00:00:00.000Z",
    purchase: { id: purchase.id, status: "DRAFT", purchaseDate: "2026-09-14T00:00:00.000Z" },
    purchaseItem: { id: purchase.items[0].id },
    source: {
      relationshipId: "relationship-1",
      supplierId: purchase.supplier.id,
      recommendedQuantity: "10.000000000",
      package: { id: "package-1", code: "CASE", quantity: "10.000000000", version: 2 },
      commercialTerms: { id: "terms-1", version: 3, unitPrice: "12.345678", currencyCode: "JPY", taxRate: "0.1000" },
    },
  },
};

const purchaseHandoffLineage = {
  handoffs: [
    {
      sourceRecommendationId: "recommendation-1",
      createdAt: "2026-09-14T00:00:00.000Z",
      purchaseItemId: "item-1",
      lineNumber: 1,
      source: handoffLineage.handoff.source,
    },
    {
      sourceRecommendationId: "recommendation-2",
      createdAt: "2026-09-14T00:00:01.000Z",
      purchaseItemId: "item-2",
      lineNumber: 2,
      source: { ...handoffLineage.handoff.source, relationshipId: "relationship-2" },
    },
  ],
};

const reversalPreview: PurchaseReversalPreview = {
  purchaseId: purchase.id,
  canReverse: true,
  refusalReasons: [],
  previewVersion: "a".repeat(64),
  existingReversal: null,
  inventoryEffects: [{
    productId: "product-1",
    inventoryId: "inventory-1",
    inventoryVersion: 7,
    inventoryUnitId: "unit-1",
    quantityDelta: "-10.000000000",
    quantityAfter: "15.000000000",
    averageUnitCost: "12.345678",
  }],
  priceEffects: [{
    productId: "product-1",
    priceMasterId: "price-master-1",
    version: 4,
    currentPriceHistoryId: "price-history-1",
    currentUnitPrice: "12.345678",
    currency: "JPY",
    source: "ORIGINAL_PURCHASE_CURRENT",
    requiresPriceResolution: true,
  }],
};

const reversalExecution: PurchaseReversalExecution = {
  id: "reversal-1",
  purchaseId: purchase.id,
  reversedAt: "2026-09-22T00:00:00.000Z",
  replayed: false,
};

const reversalAudit: PurchaseReversalAudit = {
  id: reversalExecution.id,
  purchaseId: purchase.id,
  actorUserId: "actor-1",
  reason: "duplicate supplier receipt",
  reversedAt: reversalExecution.reversedAt,
  items: [{
    purchaseItemId: "purchase-item-1",
    productId: "product-1",
    inventoryUnitId: "unit-1",
    quantity: "10.000000000",
    unitPrice: "12.345678",
    currency: "JPY",
  }],
  inventoryEffects: [{
    productId: "product-1",
    inventoryId: "inventory-1",
    inventoryUnitId: "unit-1",
    quantityDelta: "-10.000000000",
    quantityAfter: "15.000000000",
    averageUnitCost: "12.345678",
  }],
  priceEffects: [{
    priceMasterId: "price-master-1",
    source: "ORIGINAL_PURCHASE_CURRENT",
    previousCurrentPriceHistoryId: "price-history-1",
    previousVersion: 4,
    appliedUnitPrice: "12.345678",
    appliedCurrency: "JPY",
    effectiveAt: "2026-09-22T00:00:00.000Z",
    becomesCurrent: true,
    priceHistoryId: "price-history-2",
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

test("purchase response guards accept only the exact documented draft contract", () => {
  assert.equal(isPurchase(purchase), true);
  assert.equal(isPurchase({ ...purchase, extra: true }), false);
  assert.equal(isPurchase({ ...purchase, supplier: { ...purchase.supplier, extra: true } }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], extra: true }] }), false);
  assert.equal(isPurchase({ ...purchase, purchaseDate: "2026-08-21" }), false);
  assert.equal(isPurchase({ ...purchase, createdAt: "not-a-timestamp" }), false);
  assert.equal(isPurchase({ ...purchase, subtotal: "1.1234567" }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], quantity: "0" }] }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], taxRate: "1.0001" }] }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], lineNumber: 0 }] }), false);
  assert.equal(isPurchase({ ...purchase, status: "SAVED" }), false);
  assert.equal(isPurchase({ ...purchase, items: [{ ...purchase.items[0], quantity: 1 }] }), false);
  assert.equal(isPurchase({ ...purchase, cancelledAt: "2026-08-21T01:02:03.000Z" }), false);
  assert.equal(isPurchase({ ...purchase, cancellationReason: "not cancelled" }), false);
  assert.equal(isPurchase({ ...purchase, status: "CANCELLED", cancelledAt: "2026-08-21T01:02:03.000Z", cancellationReason: "supplier withdrew stock" }), true);
  assert.equal(isPurchase({ ...purchase, status: "CANCELLED", cancelledAt: null, cancellationReason: "supplier withdrew stock" }), false);
  assert.equal(isPurchase({ ...purchase, status: "CANCELLED", cancelledAt: "2026-08-21T01:02:03.000Z", cancellationReason: "   " }), false);
  assert.equal(isPurchase({ ...purchase, status: "CANCELLED", cancelledAt: "2026-08-21T01:02:03.000Z", cancellationReason: " supplier withdrew stock " }), false);
});

test("purchase detail and draft mutations pin their documented success statuses before state changes", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return purchase as T;
    },
  };
  const payload = purchasePayload(purchaseFormFromPurchase(purchase));

  assert.equal((await requestPurchaseDetail(api, purchase.id)).id, purchase.id);
  assert.equal((await createPurchaseDraft(api, payload)).id, purchase.id);
  assert.equal((await updatePurchaseDraft(api, purchase.id, payload)).id, purchase.id);
  assert.equal((await confirmPurchaseDraft(api, purchase.id)).id, purchase.id);
  assert.deepEqual(calls, [
    { path: `/purchases/${purchase.id}`, options: { expectedStatus: 200 } },
    { path: "/purchases", options: { method: "POST", body: payload, expectedStatus: 201 } },
    { path: `/purchases/${purchase.id}`, options: { method: "PATCH", body: payload, expectedStatus: 200 } },
    { path: `/purchases/${purchase.id}/confirm`, options: { method: "POST", expectedStatus: 201 } },
  ]);
});

test("recommendation handoff accepts only its documented create or idempotent-replay statuses and exact wrapper", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { purchase } as T;
    },
  };
  assert.equal((await createPurchaseDraftFromRecommendation(api, "recommendation/1", "2026-09-14T00:00:00.000Z")).id, purchase.id);
  assert.deepEqual(calls, [{
    path: "/purchases/replenishment-recommendations/recommendation%2F1/draft",
    options: { method: "POST", body: { purchaseDate: "2026-09-14T00:00:00.000Z" }, expectedStatus: [200, 201] },
  }]);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const accepted of [200, 201]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ purchase }), { status: accepted, headers: { "content-type": "application/json" } });
    assert.equal((await createPurchaseDraftFromRecommendation(createApiClient(), "recommendation-1", "2026-09-14T00:00:00.000Z")).id, purchase.id);
  }
  for (const rejected of [202, 204]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : rejected === 204
        ? new Response(null, { status: rejected })
        : new Response(JSON.stringify({ purchase }), { status: rejected, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => createPurchaseDraftFromRecommendation(createApiClient(), "recommendation-1", "2026-09-14T00:00:00.000Z"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === rejected,
    );
  }
  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ purchase, extra: true }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createPurchaseDraftFromRecommendation(createApiClient(), "recommendation-1", "2026-09-14T00:00:00.000Z"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("recommendation handoff UI can require the API's canonical UTC purchaseDate contract", () => {
  assert.equal(isCanonicalUtcTimestamp("2026-09-14T00:00:00.000Z"), true);
  assert.equal(isCanonicalUtcTimestamp("2026-09-14"), false);
  assert.equal(isCanonicalUtcTimestamp("2026-09-14T00:00:00Z"), false);
  assert.equal(isCanonicalUtcTimestamp("2026-09-14T00:00:00.000+09:00"), false);
});

test("recommendation handoff lineage is a passive exact-200 read contract", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return handoffLineage as T;
    },
  };
  assert.equal((await requestRecommendationPurchaseHandoffLineage(api, "recommendation/1"))?.purchase.id, purchase.id);
  assert.deepEqual(calls, [{
    path: "/purchases/replenishment-recommendations/recommendation%2F1/handoff",
    options: { expectedStatus: 200 },
  }]);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse({ handoff: null }), true);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse(handoffLineage), true);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse({ ...handoffLineage, extra: true }), false);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse({ handoff: { ...handoffLineage.handoff, source: { ...handoffLineage.handoff.source, extra: true } } }), false);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse({ handoff: { ...handoffLineage.handoff, createdAt: "not-a-timestamp" } }), false);
  assert.equal(isRecommendationPurchaseHandoffLineageResponse({ handoff: { ...handoffLineage.handoff, source: { ...handoffLineage.handoff.source, package: { ...handoffLineage.handoff.source.package, quantity: "0" } } } }), false);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(handoffLineage), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestRecommendationPurchaseHandoffLineage(createApiClient(), "recommendation-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ handoff: { ...handoffLineage.handoff, extra: true } }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestRecommendationPurchaseHandoffLineage(createApiClient(), "recommendation-1"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("purchase handoff lineage is a passive exact-200 multi-line read contract", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return purchaseHandoffLineage as T;
    },
  };
  assert.deepEqual((await requestPurchaseHandoffLineage(api, "purchase/1")).map((lineage) => lineage.purchaseItemId), ["item-1", "item-2"]);
  assert.deepEqual(calls, [{
    path: "/purchases/purchase%2F1/handoff-lineage",
    options: { expectedStatus: 200 },
  }]);
  assert.equal(isPurchaseHandoffLineageResponse({ handoffs: [] }), true);
  assert.equal(isPurchaseHandoffLineageResponse(purchaseHandoffLineage), true);
  assert.equal(isPurchaseHandoffLineageResponse({ ...purchaseHandoffLineage, extra: true }), false);
  assert.equal(isPurchaseHandoffLineageResponse({ handoffs: [{ ...purchaseHandoffLineage.handoffs[0]!, extra: true }] }), false);
  assert.equal(isPurchaseHandoffLineageResponse({ handoffs: [{ ...purchaseHandoffLineage.handoffs[0]!, lineNumber: 0 }] }), false);
  assert.equal(isPurchaseHandoffLineageResponse({ handoffs: [purchaseHandoffLineage.handoffs[1], purchaseHandoffLineage.handoffs[0]] }), false);
  assert.equal(isPurchaseHandoffLineageResponse({ handoffs: [purchaseHandoffLineage.handoffs[0], { ...purchaseHandoffLineage.handoffs[1], purchaseItemId: "item-1" }] }), false);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(purchaseHandoffLineage), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseHandoffLineage(createApiClient(), "purchase-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ handoffs: [{ ...purchaseHandoffLineage.handoffs[0]!, extra: true }] }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseHandoffLineage(createApiClient(), "purchase-1"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
  globalThis.fetch = async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseHandoffLineage(createApiClient(), "purchase-1"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("purchase detail and draft mutations reject arbitrary 2xx and malformed success JSON", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const payload = purchasePayload(purchaseFormFromPurchase(purchase));
  const operations = [
    { path: `/purchases/${purchase.id}`, status: 200, call: (api: ReturnType<typeof createApiClient>) => requestPurchaseDetail(api, purchase.id) },
    { path: "/purchases", status: 201, call: (api: ReturnType<typeof createApiClient>) => createPurchaseDraft(api, payload) },
    { path: `/purchases/${purchase.id}`, status: 200, call: (api: ReturnType<typeof createApiClient>) => updatePurchaseDraft(api, purchase.id, payload) },
    { path: `/purchases/${purchase.id}/confirm`, status: 201, call: (api: ReturnType<typeof createApiClient>) => confirmPurchaseDraft(api, purchase.id) },
  ];

  for (const operation of operations) {
    for (const unexpectedStatus of [200, 201, 202, 204]) {
      if (unexpectedStatus === operation.status) continue;
      globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
        ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
        : unexpectedStatus === 204
          ? new Response(null, { status: unexpectedStatus })
          : new Response(JSON.stringify(purchase), { status: unexpectedStatus, headers: { "content-type": "application/json" } });
      await assert.rejects(
        () => operation.call(createApiClient()),
        (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === unexpectedStatus,
      );
    }

    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ ...purchase, extra: true }), { status: operation.status, headers: { "content-type": "application/json" } });
    await assert.rejects(() => operation.call(createApiClient()), (error: unknown) => error instanceof ApiError && error.kind === "server");

    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : new Response("not json", { status: operation.status, headers: { "content-type": "application/json" } });
    await assert.rejects(() => operation.call(createApiClient()), (error: unknown) => error instanceof ApiError && error.kind === "server");
  }
});

test("purchase list accepts only the exact, non-financial page contract", () => {
  assert.equal(isPurchaseListPage(purchaseListPage), true);
  for (const status of ["DRAFT", "CONFIRMED", "CANCELLED", "POSTED"]) {
    assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, status, correction: null }] }), true);
  }
  const corrected = { id: "purchase-reversal-1", reversedAt: "2026-08-22T01:02:03.000Z" };
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, correction: corrected }] }), true);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, extra: true }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0], subtotal: "100" }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0], supplier: { ...purchaseListPage.items[0].supplier, id: "supplier-id" } }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0], status: "SAVED" }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0], purchaseDate: "2026-08-21" }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0], postedAt: "not-a-timestamp" }] }), false);
  const { correction: omittedCorrection, ...withoutCorrection } = purchaseListPage.items[0]!;
  void omittedCorrection;
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [withoutCorrection] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, correction: { ...corrected, reason: "detail-only" } }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, correction: { ...corrected, id: "   " } }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, correction: { ...corrected, reversedAt: "not-a-timestamp" } }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, status: "DRAFT", correction: corrected }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, items: [{ ...purchaseListPage.items[0]!, correction: { ...corrected, actorUserId: "actor-1", items: [] } }] }), false);
  assert.equal(isPurchaseListPage({ ...purchaseListPage, nextCursor: "" }), false);
  assert.equal(isPurchaseListPage([]), false);
});

test("purchase list paths retain all exact filters and opaque cursors", () => {
  const path = purchaseListPath({
    status: "CONFIRMED",
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-31T23:59:59.999Z",
    supplierCode: " SUP-001 ",
    documentNumber: "PO-001",
  }, "cursor-value");
  const url = new URL(path, "https://web.example.test");
  assert.equal(url.pathname, "/purchases");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("status"), "CONFIRMED");
  assert.equal(url.searchParams.get("from"), "2026-08-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-08-31T23:59:59.999Z");
  assert.equal(url.searchParams.get("supplierCode"), " SUP-001 ");
  assert.equal(url.searchParams.get("documentNumber"), "PO-001");
  assert.equal(url.searchParams.get("cursor"), "cursor-value");
});

test("purchase list uses exact HTTP 200 and never turns malformed responses into a list", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const calls: Array<{ options: unknown; path: string }> = [];
  const api: PurchaseListApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return purchaseListPage as T;
    },
  };
  const page = await requestPurchaseList(api, { status: "POSTED" }, "cursor-value");
  assert.equal(page.items[0]?.id, "purchase-list-1");
  assert.deepEqual(calls, [{ path: "/purchases?limit=50&status=POSTED&cursor=cursor-value", options: { expectedStatus: 200 } }]);

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(purchaseListPage), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseList(createApiClient(), {}),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ ...purchaseListPage, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseList(createApiClient(), {}),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
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

test("purchase cancellation response requires the exact persisted lifecycle authority", () => {
  const cancelled: CancelledPurchaseResult = {
    id: purchase.id,
    status: "CANCELLED",
    cancelledAt: "2026-08-21T01:02:03.000Z",
    cancellationReason: "supplier withdrew stock",
  };
  assert.equal(isCancelledPurchaseResult(cancelled, purchase.id), true);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, extra: true }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, id: "different-purchase" }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, status: "DRAFT" }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, cancelledAt: "2026-08-21" }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, cancellationReason: "   " }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, cancellationReason: " supplier withdrew stock " }, purchase.id), false);
  assert.equal(isCancelledPurchaseResult({ ...cancelled, cancellationReason: "x".repeat(10_001) }, purchase.id), false);

  const merged = mergeCancelledPurchaseResult(purchase, cancelled);
  assert.equal(merged.status, "CANCELLED");
  assert.equal(merged.postedAt, null);
  assert.equal(merged.cancelledAt, cancelled.cancelledAt);
  assert.equal(merged.cancellationReason, cancelled.cancellationReason);
  assert.equal(merged.items, purchase.items);
});

test("purchase cancellation posts a reason and accepts only the exact 200 response without a follow-up read", async () => {
  const calls: Array<{ options: unknown; path: string }> = [];
  const api: PurchaseCancellationApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return {
        id: purchase.id,
        status: "CANCELLED",
        cancelledAt: "2026-08-21T01:02:03.000Z",
        cancellationReason: "supplier withdrew stock",
      } as T;
    },
  };

  const cancelled = await requestPurchaseCancellation(api, purchase, "  supplier withdrew stock  ");
  assert.deepEqual(calls, [{
    path: `/purchases/${purchase.id}/cancel`,
    options: { method: "POST", body: { reason: "  supplier withdrew stock  " }, expectedStatus: 200 },
  }]);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.cancellationReason, "supplier withdrew stock");
});

test("purchase cancellation rejects unexpected success statuses and malformed completion bodies", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const cancelled = {
    id: purchase.id,
    status: "CANCELLED",
    cancelledAt: "2026-08-21T01:02:03.000Z",
    cancellationReason: "supplier withdrew stock",
  };
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(cancelled), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseCancellation(createApiClient(), purchase, "supplier withdrew stock"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...cancelled, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseCancellation(createApiClient(), purchase, "supplier withdrew stock"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
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

test("ambiguous purchase cancellation results require explicit reconciliation rather than a retry", () => {
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("server", 201)), true);
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("network")), true);
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("conflict", 409)), true);
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("validation", 422)), false);
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("forbidden", 403)), false);
  assert.equal(isAmbiguousPurchaseCancellationError(new ApiError("unauthorized", 401)), false);
});

test("posted purchase reversal accepts only its strict preview, request, and completion contracts", () => {
  assert.equal(isPurchaseReversalPreview(reversalPreview), true);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, extra: true }), false);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, previewVersion: "not-a-preview" }), false);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, inventoryEffects: [{ ...reversalPreview.inventoryEffects[0]!, inventoryVersion: 0 }] }), false);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, priceEffects: [{ ...reversalPreview.priceEffects[0]!, source: "UNSUPPORTED" }] }), false);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, priceEffects: [reversalPreview.priceEffects[0]!, reversalPreview.priceEffects[0]!] }), false);
  assert.equal(isPurchaseReversalPreview({ ...reversalPreview, existingReversal: { id: "reversal-1", reversedAt: "not-a-timestamp" } }), false);

  const request = createPurchaseReversalRequest(reversalPreview, "  duplicate supplier receipt  ", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6a", {
    "product-1": { currentUnitPrice: "12.345678", currency: "JPY" },
  });
  assert.deepEqual(request, {
    reason: "duplicate supplier receipt",
    previewVersion: reversalPreview.previewVersion,
    idempotencyKey: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6a",
    priceResolutions: [{ productId: "product-1", expectedPriceMasterVersion: 4, currentUnitPrice: "12.345678", currency: "JPY" }],
  });
  assert.equal(isPurchaseReversalRequest(request), true);
  assert.equal(isPurchaseReversalRequest({ ...request, priceResolutions: [...request.priceResolutions, request.priceResolutions[0]!] }), false);
  assert.equal(isPurchaseReversalRequest({ ...request, idempotencyKey: "not-a-uuid" }), false);
  const laterPriceRemainsCurrent: PurchaseReversalPreview = {
    ...reversalPreview,
    priceEffects: [{ ...reversalPreview.priceEffects[0]!, source: "SUBSEQUENT_PRICE_HISTORY_CURRENT", requiresPriceResolution: false }],
  };
  assert.deepEqual(createPurchaseReversalRequest(laterPriceRemainsCurrent, "correction", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6a", {}).priceResolutions, []);
  assert.equal(isPurchaseReversalExecution(reversalExecution, purchase.id), true);
  assert.equal(isPurchaseReversalExecution({ ...reversalExecution, replayed: "false" }, purchase.id), false);
});

test("posted purchase reversal pins preview and execute requests to their documented methods, bodies, and success statuses", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: PurchaseReversalApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return path.endsWith("/reversal-preview") ? reversalPreview as T : reversalExecution as T;
    },
  };
  const preview = await requestPurchaseReversalPreview(api, purchase.id);
  const request = createPurchaseReversalRequest(preview, "correction", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6a", {
    "product-1": { currentUnitPrice: "12.345678", currency: "JPY" },
  });
  assert.equal((await requestPurchaseReversal(api, purchase.id, request)).id, reversalExecution.id);
  assert.deepEqual(calls, [
    { path: `/purchases/${purchase.id}/reversal-preview`, options: { expectedStatus: 200 } },
    { path: `/purchases/${purchase.id}/reversals`, options: { method: "POST", body: request, expectedStatus: [200, 201] } },
  ]);
});

test("posted purchase reversal audit readback accepts only an exact immutable ledger contract", () => {
  assert.equal(isPurchaseReversalAuditResponse({ reversal: null }), true);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: reversalAudit }), true);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: reversalAudit, extra: true }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, extra: true } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, reversedAt: "not-a-timestamp" } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, items: [{ ...reversalAudit.items[0]!, quantity: "0" }] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, priceEffects: [{ ...reversalAudit.priceEffects[0]!, source: "MISSING_PRICE_MASTER" }] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, priceEffects: [{ ...reversalAudit.priceEffects[0]!, previousVersion: 0 }] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, items: [reversalAudit.items[0]!, reversalAudit.items[0]!] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, inventoryEffects: [reversalAudit.inventoryEffects[0]!, reversalAudit.inventoryEffects[0]!] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, inventoryEffects: [reversalAudit.inventoryEffects[0]!, { ...reversalAudit.inventoryEffects[0]!, inventoryId: "inventory-2" }] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, priceEffects: [reversalAudit.priceEffects[0]!, reversalAudit.priceEffects[0]!] } }), false);

  const earlierItem = { ...reversalAudit.items[0]!, purchaseItemId: "purchase-item-0" };
  const laterInventory = { ...reversalAudit.inventoryEffects[0]!, productId: "product-2", inventoryId: "inventory-2" };
  const laterPrice = { ...reversalAudit.priceEffects[0]!, priceMasterId: "price-master-2", priceHistoryId: "price-history-3" };
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, items: [reversalAudit.items[0]!, earlierItem] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, inventoryEffects: [laterInventory, reversalAudit.inventoryEffects[0]!] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, priceEffects: [laterPrice, reversalAudit.priceEffects[0]!] } }), false);
  assert.equal(isPurchaseReversalAuditResponse({ reversal: { ...reversalAudit, inventoryEffects: [{ ...reversalAudit.inventoryEffects[0]!, quantityAfter: null }] } }), false);
});

test("posted purchase reversal audit readback is a passive exact-200 GET and fails closed", async (t) => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: PurchaseReversalAuditApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      return { reversal: reversalAudit } as T;
    },
  };
  assert.deepEqual(await requestPurchaseReversalAudit(api, purchase.id), reversalAudit);
  assert.deepEqual(calls, [{ path: `/purchases/${purchase.id}/reversal`, options: { expectedStatus: 200 } }]);

  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify({ reversal: reversalAudit }), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseReversalAudit(createApiClient(), purchase.id),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async () => new Response("not json", { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseReversalAudit(createApiClient(), purchase.id),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("posted purchase reversal rejects unexpected success statuses and malformed responses", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = createPurchaseReversalRequest(reversalPreview, "correction", "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6a", {
    "product-1": { currentUnitPrice: "12.345678", currency: "JPY" },
  });

  for (const status of [200, 201]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ ...reversalExecution, replayed: status === 200 }), { status, headers: { "content-type": "application/json" } });
    assert.equal((await requestPurchaseReversal(createApiClient(), purchase.id, request)).replayed, status === 200);
  }

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(reversalPreview), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseReversalPreview(createApiClient(), purchase.id),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  for (const status of [202, 204]) {
    globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
      ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
      : status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(reversalExecution), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestPurchaseReversal(createApiClient(), purchase.id, request),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ ...reversalPreview, extra: true }), { headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => requestPurchaseReversalPreview(createApiClient(), purchase.id),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("posted purchase reversal workflow state prevents duplicate writes and requires reconciliation after ambiguity", () => {
  const postedPurchase: Purchase = { ...purchase, status: "POSTED", postedAt: "2026-09-21T00:00:00.000Z" };
  let state: PurchaseReversalWorkflowState = { phase: "idle" };
  assert.equal(canStartPurchaseReversal(purchase, true, state), false);
  assert.equal(canStartPurchaseReversal(postedPurchase, false, state), false);
  assert.equal(canStartPurchaseReversal(postedPurchase, true, state), true);

  state = startPurchaseReversalPreview(false);
  assert.equal(canSubmitPurchaseReversal(state, false), false);
  const executable = settlePurchaseReversalPreview(reversalPreview, true);
  assert.equal(canExecutePurchaseReversal(executable), true);
  assert.equal(canSubmitPurchaseReversal(executable, true), false);
  assert.equal(canSubmitPurchaseReversal(executable, false), true);
  assert.equal(isAmbiguousPurchaseReversalError(new ApiError("validation", 422)), false);
  assert.equal(canSubmitPurchaseReversal(executable, false), true);

  const completed = completePurchaseReversal(reversalExecution);
  assert.equal(canStartPurchaseReversal(postedPurchase, true, completed), false);
  const existing = settlePurchaseReversalPreview({ ...reversalPreview, canReverse: false, refusalReasons: ["This purchase has already been corrected."], existingReversal: { id: reversalExecution.id, reversedAt: reversalExecution.reversedAt } }, true);
  assert.deepEqual(existing, completed);

  const unknown = markPurchaseReversalUnknown();
  assert.equal(canSubmitPurchaseReversal(unknown, false), false);
  const reconciledWithoutReversal = settlePurchaseReversalPreview(reversalPreview, false);
  assert.equal(canSubmitPurchaseReversal(reconciledWithoutReversal, false), false);
  assert.equal(canSubmitPurchaseReversal(settlePurchaseReversalPreview(reversalPreview, true), false), true);
  assert.equal(isAmbiguousPurchaseReversalError(new ApiError("conflict", 409)), true);
  assert.equal(isAmbiguousPurchaseReversalError(new ApiError("server", 500)), true);
  assert.equal(isAmbiguousPurchaseReversalError(new ApiError("network")), true);
});
