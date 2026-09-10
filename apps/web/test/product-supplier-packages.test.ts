import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  createProductSupplierPackage,
  isProductSupplierPackageContext,
  isProductSupplierPackagesContext,
  requestProductSupplierPackage,
  requestProductSupplierPackages,
  updateProductSupplierPackage,
  validatePackageQuantity,
  type ProductSupplierPackagesApi,
} from "../lib/product-supplier-packages.ts";

const packageValue = {
  id: "package-1",
  relationshipId: "relationship-1",
  code: "CASE",
  name: "10 kg case",
  inventoryQuantityPerPackage: "10.000000000",
  isOrderable: true,
  status: "ACTIVE" as const,
  version: 2,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T01:00:00.000Z",
};

const relationship = {
  id: "relationship-1",
  status: "DISABLED" as const,
  version: 3,
  product: {
    id: "product-1", code: "P-001", name: "Product", status: "INACTIVE" as const, isDeleted: true,
    inventoryUnit: { code: "KG", name: "Kilogram", symbol: "kg" },
  },
  supplier: { id: "supplier-1", code: "S-001", name: "Supplier", status: "INACTIVE" as const, isDeleted: true },
};

const packagesContext = { relationship, packages: [packageValue] };
const packageContext = { relationship, package: packageValue };

test("supplier packages accept only exact relationship-scoped contracts", () => {
  assert.equal(isProductSupplierPackagesContext(packagesContext), true);
  assert.equal(isProductSupplierPackageContext(packageContext), true);
  assert.equal(isProductSupplierPackagesContext({ ...packagesContext, extra: true }), false);
  assert.equal(isProductSupplierPackageContext({ ...packageContext, package: { ...packageValue, inventoryQuantityPerPackage: "0" } }), false);
  assert.equal(isProductSupplierPackageContext({ ...packageContext, package: { ...packageValue, isOrderable: "true" } }), false);
  assert.equal(isProductSupplierPackageContext({ ...packageContext, package: { ...packageValue, status: "INACTIVE" } }), false);
  assert.equal(isProductSupplierPackageContext({ ...packageContext, package: { ...packageValue, createdAt: "2026-09-11" } }), false);
  assert.equal(isProductSupplierPackageContext({ ...packageContext, package: { ...packageValue, extra: true } }), false);
  assert.equal(isProductSupplierPackagesContext({ ...packagesContext, packages: [packageValue, { ...packageValue, id: "package-2" }] }), false);
  assert.equal(isProductSupplierPackagesContext({ ...packagesContext, packages: [{ ...packageValue, relationshipId: "relationship-2" }] }), false);
});

test("supplier package requests use exact status and response-authoritative mutation bodies", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ProductSupplierPackagesApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      if ((options as { method?: string } | undefined)?.method === "POST") return { ...packageContext, package: { ...packageValue, version: 1 } } as T;
      if ((options as { method?: string } | undefined)?.method === "PATCH") return { ...packageContext, package: { ...packageValue, version: 3 } } as T;
      return path.endsWith("/package-1") ? packageContext as T : packagesContext as T;
    },
  };
  const input = { code: "CASE", name: "10 kg case", inventoryQuantityPerPackage: "10", isOrderable: true, status: "ACTIVE" as const };
  assert.deepEqual(await requestProductSupplierPackages(api, "relationship-1"), packagesContext);
  assert.deepEqual(await requestProductSupplierPackage(api, "relationship-1", "package-1"), packageContext);
  assert.equal((await createProductSupplierPackage(api, "relationship-1", input)).package.version, 1);
  assert.equal((await updateProductSupplierPackage(api, "relationship-1", "package-1", input, 2)).package.version, 3);
  assert.deepEqual(calls, [
    { path: "/product-supply-relationships/relationship-1/packages", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships/relationship-1/packages/package-1", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships/relationship-1/packages", options: { method: "POST", body: input, expectedStatus: 201 } },
    { path: "/product-supply-relationships/relationship-1/packages/package-1", options: { method: "PATCH", body: { ...input, expectedVersion: 2 }, expectedStatus: 200 } },
  ]);
});

test("supplier package paths reject unexpected 2xx and malformed response bodies", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => { process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl; globalThis.fetch = originalFetch; });
  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(packagesContext), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductSupplierPackages(createApiClient(), "relationship-1"),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }
  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...packageContext, extra: true }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createProductSupplierPackage(createApiClient(), "relationship-1", { code: "CASE", name: "Case", inventoryQuantityPerPackage: "10", isOrderable: true, status: "ACTIVE" }),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});

test("supplier packages preserve positive Decimal inventory-unit conversion semantics", () => {
  assert.equal(validatePackageQuantity("0.000000001"), null);
  assert.equal(validatePackageQuantity("999999999999999.123456789"), null);
  assert.notEqual(validatePackageQuantity("0"), null);
  assert.notEqual(validatePackageQuantity("-1"), null);
  assert.notEqual(validatePackageQuantity("01"), null);
  assert.notEqual(validatePackageQuantity("1e3"), null);
});
