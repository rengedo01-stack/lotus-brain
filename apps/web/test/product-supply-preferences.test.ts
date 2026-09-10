import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import { clearProductSupplyPreference, isProductSupplierPackagePreferenceContext, isProductSupplyPreferenceContext, requestProductSupplyPreference, setProductSupplierPackagePreference, setProductSupplyPreference, type ProductSupplyPreferencesApi } from "../lib/product-supply-preferences.ts";

const product = { id: "p1", code: "P1", name: "Product", status: "ACTIVE" as const, isDeleted: false };
const supplier = { id: "s1", code: "S1", name: "Supplier", status: "ACTIVE" as const, isDeleted: false };
const relationship = { id: "r1", status: "ACTIVE" as const, supplier };
const supplierContext = { product, preference: { id: "sp1", productId: "p1", relationshipId: "r1", version: 1, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", relationship, isEligible: true } };
const packageValue = { id: "k1", relationshipId: "r1", code: "CASE", name: "Case", inventoryQuantityPerPackage: "10.000000000", isOrderable: true, status: "ACTIVE" as const };
const packageContext = { relationship: { ...relationship, product }, preference: { id: "pp1", relationshipId: "r1", packageId: "k1", version: 1, createdAt: "2026-09-11T00:00:00.000Z", updatedAt: "2026-09-11T00:00:00.000Z", package: packageValue, isEligible: true } };

test("preference contracts are exact and preserve stale intent", () => {
  assert.equal(isProductSupplyPreferenceContext(supplierContext), true);
  assert.equal(isProductSupplierPackagePreferenceContext(packageContext), true);
  assert.equal(isProductSupplyPreferenceContext({ ...supplierContext, extra: true }), false);
  assert.equal(isProductSupplyPreferenceContext({ ...supplierContext, preference: { ...supplierContext.preference, isEligible: "true" } }), false);
  assert.equal(isProductSupplyPreferenceContext({ ...supplierContext, preference: { ...supplierContext.preference, createdAt: "2026-09-11" } }), false);
  assert.equal(isProductSupplyPreferenceContext({ ...supplierContext, preference: { ...supplierContext.preference, relationshipId: "r2" } }), false);
  assert.equal(isProductSupplierPackagePreferenceContext({ ...packageContext, preference: { ...packageContext.preference, package: { ...packageValue, extra: true } } }), false);
  assert.equal(isProductSupplierPackagePreferenceContext({ ...packageContext, preference: { ...packageContext.preference, packageId: "other" } }), false);
  assert.equal(isProductSupplierPackagePreferenceContext({ ...packageContext, preference: { ...packageContext.preference, package: { ...packageValue, relationshipId: "r2" } } }), false);
});

test("preference mutations use exact status and explicit optimistic versions", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ProductSupplyPreferencesApi = { async request<T>(path: string, options?: unknown): Promise<T> { calls.push({ path, options }); return (path.includes("package-preference") ? packageContext : supplierContext) as T; } };
  await requestProductSupplyPreference(api, "p1");
  await setProductSupplyPreference(api, "p1", "r1", null);
  await clearProductSupplyPreference(api, "p1", 1);
  await setProductSupplierPackagePreference(api, "r1", "k1", 1);
  assert.deepEqual(calls, [
    { path: "/products/p1/supply-preference", options: { expectedStatus: 200 } },
    { path: "/products/p1/supply-preference", options: { method: "PUT", body: { relationshipId: "r1", expectedVersion: null }, expectedStatus: 200 } },
    { path: "/products/p1/supply-preference", options: { method: "DELETE", body: { expectedVersion: 1 }, expectedStatus: 200 } },
    { path: "/product-supply-relationships/r1/package-preference", options: { method: "PUT", body: { packageId: "k1", expectedVersion: 1 }, expectedStatus: 200 } },
  ]);
});

test("unexpected 2xx and malformed preference responses fail closed", async (t) => {
  const old = process.env.NEXT_PUBLIC_API_BASE_URL; const fetchValue = globalThis.fetch; process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = old; globalThis.fetch = fetchValue; });
  globalThis.fetch = async () => new Response(JSON.stringify(supplierContext), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(() => requestProductSupplyPreference(createApiClient(), "p1"), (e: unknown) => e instanceof ApiError && e.kind === "server");
  globalThis.fetch = async () => new Response(JSON.stringify({ ...supplierContext, extra: true }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(() => requestProductSupplyPreference(createApiClient(), "p1"), (e: unknown) => e instanceof ApiError && e.kind === "server");
});
