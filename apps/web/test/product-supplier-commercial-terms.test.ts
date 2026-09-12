import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  clearProductSupplierCommercialTerms,
  createProductSupplierCommercialTerms,
  isProductSupplierCommercialTermsContext,
  requestProductSupplierCommercialTerms,
  updateProductSupplierCommercialTerms,
  validateCommercialTaxRate,
  validateCommercialUnitPrice,
  type ProductSupplierCommercialTermsApi,
} from "../lib/product-supplier-commercial-terms.ts";

const context = {
  relationship: {
    id: "relationship-1",
    status: "DISABLED",
    version: 3,
    product: { id: "product-1", code: "P-001", name: "Product", status: "INACTIVE", isDeleted: true, inventoryUnit: { code: "KG", name: "Kilogram", symbol: "kg" } },
    supplier: { id: "supplier-1", code: "S-001", name: "Supplier", status: "INACTIVE", isDeleted: true },
  },
  terms: {
    id: "terms-1",
    relationshipId: "relationship-1",
    unitPrice: "120.500000",
    currencyCode: "JPY",
    taxRate: "0.1000",
    version: 2,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T01:00:00.000Z",
  },
};

test("commercial terms accept only exact current-state contracts", () => {
  assert.equal(isProductSupplierCommercialTermsContext(context), true);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, extra: true }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, terms: { ...context.terms, currencyCode: "USD" } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, terms: { ...context.terms, unitPrice: "120.5" } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, terms: { ...context.terms, taxRate: "1.0001" } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, terms: { ...context.terms, version: 0 } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, relationship: { ...context.relationship, status: "INACTIVE" } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, relationship: { ...context.relationship, product: { ...context.relationship.product, inventoryUnit: { ...context.relationship.product.inventoryUnit, extra: true } } } }), false);
  assert.equal(isProductSupplierCommercialTermsContext({ ...context, terms: null }), true);
});

test("commercial terms use exact status and response-authoritative mutation contracts", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ProductSupplierCommercialTermsApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      const method = (options as { method?: string } | undefined)?.method;
      if (method === "POST") return { ...context, terms: { ...context.terms, version: 1 } } as T;
      if (method === "PATCH") return { ...context, terms: { ...context.terms, version: 3 } } as T;
      if (method === "DELETE") return { ...context, terms: null } as T;
      return context as T;
    },
  };
  assert.deepEqual(await requestProductSupplierCommercialTerms(api, "relationship-1"), context);
  assert.equal((await createProductSupplierCommercialTerms(api, "relationship-1", "120.5", "0.1")).terms?.version, 1);
  assert.equal((await updateProductSupplierCommercialTerms(api, "relationship-1", "121", "0", 2)).terms?.version, 3);
  assert.equal((await clearProductSupplierCommercialTerms(api, "relationship-1", 3)).terms, null);
  assert.deepEqual(calls, [
    { path: "/product-supply-relationships/relationship-1/commercial-terms", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships/relationship-1/commercial-terms", options: { method: "POST", body: { unitPrice: "120.5", currencyCode: "JPY", taxRate: "0.1" }, expectedStatus: 201 } },
    { path: "/product-supply-relationships/relationship-1/commercial-terms", options: { method: "PATCH", body: { unitPrice: "121", currencyCode: "JPY", taxRate: "0", expectedVersion: 2 }, expectedStatus: 200 } },
    { path: "/product-supply-relationships/relationship-1/commercial-terms", options: { method: "DELETE", body: { expectedVersion: 3 }, expectedStatus: 200 } },
  ]);
});

test("commercial terms reject unexpected 2xx and malformed responses", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(context), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductSupplierCommercialTerms(createApiClient(), "relationship-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...context, terms: { ...context.terms, extra: true } }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createProductSupplierCommercialTerms(createApiClient(), "relationship-1", "120", "0.1"),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("commercial terms preserve exact Decimal price and tax semantics", () => {
  assert.equal(validateCommercialUnitPrice("0"), null);
  assert.equal(validateCommercialUnitPrice("99999999999999.123456"), null);
  assert.notEqual(validateCommercialUnitPrice("-1"), null);
  assert.notEqual(validateCommercialUnitPrice("01"), null);
  assert.notEqual(validateCommercialUnitPrice("1.1234567"), null);
  assert.equal(validateCommercialTaxRate("0"), null);
  assert.equal(validateCommercialTaxRate("1.0000"), null);
  assert.notEqual(validateCommercialTaxRate("1.0001"), null);
  assert.notEqual(validateCommercialTaxRate("0.12345"), null);
});
