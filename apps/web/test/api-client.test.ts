import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient, subscribeToApiSessionEvents } from "../lib/api-client.ts";

const apiBaseUrl = "https://api.example.test/api/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function installFetch(t: Parameters<typeof test>[1] extends (context: infer Context) => unknown ? Context : never, implementation: typeof fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("API client sends credentialed JSON requests through the configured API origin", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  installFetch(t, async (input, init) => {
    assert.equal(input, `${apiBaseUrl}/products`);
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return jsonResponse({ id: "product-1" });
  });

  const result = await createApiClient().request<{ id: string }>("/products");
  assert.deepEqual(result, { id: "product-1" });
});

test("API client maps a 401 to session expiry without retaining its CSRF token", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const events: string[] = [];
  const unsubscribe = subscribeToApiSessionEvents((event) => events.push(event));
  t.after(unsubscribe);
  installFetch(t, async () => jsonResponse({ message: "Authentication required." }, 401));

  await assert.rejects(
    () => createApiClient().request("/auth/me"),
    (error: unknown) => error instanceof ApiError && error.kind === "unauthorized" && error.status === 401,
  );
  assert.deepEqual(events, ["unauthorized"]);
});

test("API client maps forbidden, validation, and network failures to safe error categories", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const client = createApiClient();
  const responses = [
    jsonResponse({ message: "Permission denied." }, 403),
    jsonResponse({ message: "Invalid." }, 400),
    jsonResponse({ message: "Invalid." }, 422),
  ];
  installFetch(t, async () => responses.shift() ?? Promise.reject(new TypeError("Network failed")));

  await assert.rejects(() => client.request("/products"), (error: unknown) => error instanceof ApiError && error.kind === "forbidden");
  await assert.rejects(() => client.request("/products"), (error: unknown) => error instanceof ApiError && error.kind === "validation");
  await assert.rejects(() => client.request("/products"), (error: unknown) => error instanceof ApiError && error.kind === "validation");
  await assert.rejects(() => client.request("/products"), (error: unknown) => error instanceof ApiError && error.kind === "network");
});

test("unsafe API requests obtain a CSRF token in memory and attach it to the mutation", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (calls.length === 1) return jsonResponse({ csrfToken: "csrf-from-server" });
    return jsonResponse({ status: "ok" });
  });

  await createApiClient().request("/auth/logout", { method: "POST" });
  assert.equal(calls[0]?.input, `${apiBaseUrl}/auth/csrf`);
  assert.equal(calls[1]?.input, `${apiBaseUrl}/auth/logout`);
  assert.equal(new Headers(calls[1]?.init?.headers).get("x-csrf-token"), "csrf-from-server");
});
