import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import {
  createProductSupplyRelationship,
  isProductSupplyRelationship,
  isProductSupplyRelationshipList,
  requestProductSupplyRelationshipProductOptions,
  requestProductSupplyRelationships,
  requestProductSupplyRelationshipSupplierOptions,
  updateProductSupplyRelationshipStatus,
  type ProductSupplyRelationshipApi,
} from "../lib/product-supply-relationships.ts";

const product = {
  id: "product-1",
  code: "PRODUCT-001",
  name: "Product one",
  status: "ACTIVE",
  isDeleted: false,
};

const supplier = {
  id: "supplier-1",
  code: "SUPPLIER-001",
  name: "Supplier one",
  status: "ACTIVE",
  isDeleted: false,
};

const relationship = {
  id: "relationship-1",
  productId: product.id,
  supplierId: supplier.id,
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  product,
  supplier,
};

const productOption = {
  id: product.id,
  code: product.code,
  name: product.name,
  description: null,
  baseUnitId: "unit-base",
  inventoryUnitId: "unit-inventory",
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

const supplierOption = {
  id: supplier.id,
  code: supplier.code,
  name: supplier.name,
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

test("Product-Supplier relationship validators accept only the exact runtime contract", () => {
  assert.equal(isProductSupplyRelationship(relationship), true);
  assert.equal(isProductSupplyRelationship({ ...relationship, extra: true }), false);
  assert.equal(isProductSupplyRelationship({ ...relationship, status: "INACTIVE" }), false);
  assert.equal(isProductSupplyRelationship({ ...relationship, version: 0 }), false);
  assert.equal(isProductSupplyRelationship({ ...relationship, createdAt: "2026-09-10" }), false);
  assert.equal(isProductSupplyRelationship({ ...relationship, product: { ...product, deletedAt: null } }), false);
  assert.equal(isProductSupplyRelationship({ ...relationship, productId: "another-product" }), false);
  assert.equal(isProductSupplyRelationshipList([relationship]), true);
  assert.equal(isProductSupplyRelationshipList([relationship, relationship]), false);
  assert.equal(isProductSupplyRelationshipList([{ ...relationship, supplier: { ...supplier, isDeleted: "false" } }]), false);
});

test("Product-Supplier relationship requests use exact status contracts and response authority", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api: ProductSupplyRelationshipApi = {
    async request<T>(path: string, options?: unknown): Promise<T> {
      calls.push({ path, options });
      if (path.startsWith("/products")) return [productOption] as T;
      if (path.startsWith("/suppliers")) return [supplierOption] as T;
      if ((options as { method?: string } | undefined)?.method === "PATCH") return { ...relationship, status: "DISABLED", version: 2 } as T;
      return (options as { method?: string } | undefined)?.method === "POST" ? relationship as T : [relationship] as T;
    },
  };

  assert.deepEqual(await requestProductSupplyRelationships(api), [relationship]);
  assert.deepEqual(await requestProductSupplyRelationshipProductOptions(api), [productOption]);
  assert.deepEqual(await requestProductSupplyRelationshipSupplierOptions(api), [supplierOption]);
  assert.deepEqual(await createProductSupplyRelationship(api, product.id, supplier.id), relationship);
  assert.deepEqual(
    await updateProductSupplyRelationshipStatus(api, relationship.id, "DISABLED", relationship.version),
    { ...relationship, status: "DISABLED", version: 2 },
  );
  assert.deepEqual(calls, [
    { path: "/product-supply-relationships?limit=100&offset=0", options: { expectedStatus: 200 } },
    { path: "/products?limit=100&offset=0", options: { expectedStatus: 200 } },
    { path: "/suppliers?limit=100&offset=0", options: { expectedStatus: 200 } },
    { path: "/product-supply-relationships", options: { method: "POST", body: { productId: product.id, supplierId: supplier.id }, expectedStatus: 201 } },
    { path: "/product-supply-relationships/relationship-1", options: { method: "PATCH", body: { status: "DISABLED", expectedVersion: 1 }, expectedStatus: 200 } },
  ]);
});

test("Product-Supplier relationship rejects unexpected 2xx and malformed success bodies", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
    globalThis.fetch = originalFetch;
  });

  for (const status of [201, 202, 204]) {
    globalThis.fetch = async () => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify([relationship]), { status, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => requestProductSupplyRelationships(createApiClient()),
      (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
    );
  }

  globalThis.fetch = async (input) => String(input).endsWith("/auth/csrf")
    ? new Response(JSON.stringify({ csrfToken: "csrf-token" }), { headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ ...relationship, extra: true }), { status: 201, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => createProductSupplyRelationship(createApiClient(), product.id, supplier.id),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );

  const malformedOptionsApi: ProductSupplyRelationshipApi = {
    async request<T>(path: string): Promise<T> {
      return (path.startsWith("/products") ? [{ ...productOption, extra: true }] : [{ ...supplierOption, status: "DISABLED" }]) as T;
    },
  };
  await assert.rejects(
    () => requestProductSupplyRelationshipProductOptions(malformedOptionsApi),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
  await assert.rejects(
    () => requestProductSupplyRelationshipSupplierOptions(malformedOptionsApi),
    (error: unknown) => error instanceof ApiError && error.kind === "server",
  );
});
