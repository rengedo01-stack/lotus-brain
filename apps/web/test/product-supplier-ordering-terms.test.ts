import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  createProductSupplierOrderingTerms,
  isProductSupplierOrderingTermsContext,
  isProductSupplierOrderingTermsContextList,
  requestProductSupplierOrderingTerms,
  requestProductSupplierOrderingTermsList,
  updateProductSupplierOrderingTerms,
  validateOrderingTermsQuantity,
  type ProductSupplierOrderingTermsApi,
} from "../lib/product-supplier-ordering-terms.ts";

const context = {
  relationship: {
    id: "relationship-1",
    status: "DISABLED",
    version: 3,
    product: {
      id: "product-1", code: "P-001", name: "Product", status: "INACTIVE", isDeleted: true,
      inventoryUnit: { code: "KG", name: "Kilogram", symbol: "kg" },
    },
    supplier: { id: "supplier-1", code: "S-001", name: "Supplier", status: "INACTIVE", isDeleted: true },
  },
  terms: {
    id: "terms-1",
    relationshipId: "relationship-1",
    minimumOrderQuantity: "12.000000000",
    orderMultipleQuantity: "5.000000000",
    version: 2,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T01:00:00.000Z",
  },
};

test("ordering terms accept only exact current-state contracts", () => {
  assert.equal(isProductSupplierOrderingTermsContext(context), true);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, extra: true }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, terms: { ...context.terms, minimumOrderQuantity: "0" } }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, terms: { ...context.terms, orderMultipleQuantity: -1 } }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, terms: { ...context.terms, version: 0 } }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, relationship: { ...context.relationship, status: "INACTIVE" } }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, relationship: { ...context.relationship, product: { ...context.relationship.product, inventoryUnit: { ...context.relationship.product.inventoryUnit, extra: true } } } }), false);
  assert.equal(isProductSupplierOrderingTermsContext({ ...context, terms: null }), true);
  assert.equal(isProductSupplierOrderingTermsContextList([context]), true);
  assert.equal(isProductSupplierOrderingTermsContextList([context, context]), false);
  assert.equal(isProductSupplierOrderingTermsContextList([{ ...context, terms: null }]), false);
});

test("ordering terms use exact status and response-authoritative mutation contracts", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ProductSupplierOrderingTermsApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      if (path.includes("?")) return [context] as T;
      if ((options as { method?: string } | undefined)?.method === "POST") return { ...context, terms: { ...context.terms, version: 1 } } as T;
      if ((options as { method?: string } | undefined)?.method === "PATCH") return { ...context, terms: { ...context.terms, version: 3 } } as T;
      return context as T;
    },
  };
  assert.deepEqual(await requestProductSupplierOrderingTerms(api, "relationship-1"), context);
  assert.deepEqual(await requestProductSupplierOrderingTermsList(api), [context]);
  assert.equal((await createProductSupplierOrderingTerms(api, "relationship-1", null, "5")).terms?.version, 1);
  assert.equal((await updateProductSupplierOrderingTerms(api, "relationship-1", "12", "5", 2)).terms?.version, 3);
  assert.deepEqual(calls, [
    { path: "/product-supply-relationships/relationship-1/ordering-terms", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships/ordering-terms?limit=100&offset=0", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships/relationship-1/ordering-terms", options: { method: "POST", body: { minimumOrderQuantity: null, orderMultipleQuantity: "5" }, expectedStatus: 201 } },
    { path: "/product-supply-relationships/relationship-1/ordering-terms", options: { method: "PATCH", body: { minimumOrderQuantity: "12", orderMultipleQuantity: "5", expectedVersion: 2 }, expectedStatus: 200 } },
  ]);
});

test("ordering terms reject unexpected 2xx and malformed responses", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(context), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductSupplierOrderingTerms(createApiClient(), "relationship-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...context, extra: true }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createProductSupplierOrderingTerms(createApiClient(), "relationship-1", null, null),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("ordering terms preserve nullable positive Decimal inventory-unit semantics", () => {
  assert.equal(validateOrderingTermsQuantity(""), null);
  assert.equal(validateOrderingTermsQuantity("0.000000001"), null);
  assert.equal(validateOrderingTermsQuantity("999999999999999.123456789"), null);
  assert.notEqual(validateOrderingTermsQuantity("0"), null);
  assert.notEqual(validateOrderingTermsQuantity("-1"), null);
  assert.notEqual(validateOrderingTermsQuantity("01"), null);
  assert.notEqual(validateOrderingTermsQuantity("1e3"), null);
});
