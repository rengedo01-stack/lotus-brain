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

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve: resolve!, reject: reject! };
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

test("an opted-in exact status contract rejects an unexpected 2xx without emitting an unauthorized event", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const events: string[] = [];
  const unsubscribe = subscribeToApiSessionEvents((event) => events.push(event));
  t.after(unsubscribe);
  installFetch(t, async () => jsonResponse({ user: "unexpected" }, 201));

  await assert.rejects(
    () => createApiClient().request("/auth/me", { expectedStatus: 200 }),
    (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === 201,
  );
  assert.deepEqual(events, []);
});

test("endpoints without an exact-status contract retain their existing 2xx behavior", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  installFetch(t, async () => jsonResponse({ status: "accepted" }, 202));

  assert.deepEqual(await createApiClient().request("/existing-202-contract"), { status: "accepted" });
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

test("unsafe API requests obtain an exact CSRF token in memory and attach it to the mutation", async (t) => {
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

test("concurrent unsafe requests singleflight one CSRF acquisition per epoch", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const csrfResponse = deferred<Response>();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (String(input).endsWith("/auth/csrf")) return csrfResponse.promise;
    return jsonResponse({ status: "ok" });
  });

  const client = createApiClient();
  const first = client.request("/mutations/one", { method: "POST" });
  const second = client.request("/mutations/two", { method: "POST" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, `${apiBaseUrl}/auth/csrf`);

  csrfResponse.resolve(jsonResponse({ csrfToken: "csrf-shared-token" }));
  await Promise.all([first, second]);

  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[1]?.init?.headers).get("x-csrf-token"), "csrf-shared-token");
  assert.equal(new Headers(calls[2]?.init?.headers).get("x-csrf-token"), "csrf-shared-token");
});

test("invalidating a CSRF epoch blocks an old acquisition and its waiting mutation", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const oldCsrfResponse = deferred<Response>();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (String(input).endsWith("/auth/csrf")) return oldCsrfResponse.promise;
    return jsonResponse({ status: "ok" });
  });

  const client = createApiClient();
  const oldMutation = client.request("/mutations/old", { method: "POST" });
  client.clearCsrfToken();
  oldCsrfResponse.resolve(jsonResponse({ csrfToken: "old-token" }));

  await assert.rejects(
    () => oldMutation,
    (error: unknown) => error instanceof ApiError && error.kind === "network",
  );
  assert.equal(calls.length, 1);
});

test("new CSRF epochs do not share an old acquisition or adopt its late response", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const oldCsrfResponse = deferred<Response>();
  const newCsrfResponse = deferred<Response>();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (!String(input).endsWith("/auth/csrf")) return jsonResponse({ status: "ok" });
    return calls.filter((call) => String(call.input).endsWith("/auth/csrf")).length === 1
      ? oldCsrfResponse.promise
      : newCsrfResponse.promise;
  });

  const client = createApiClient();
  const oldMutation = client.request("/mutations/old", { method: "POST" });
  client.clearCsrfToken();
  const newMutation = client.request("/mutations/new", { method: "POST" });

  newCsrfResponse.resolve(jsonResponse({ csrfToken: "new-token" }));
  await newMutation;
  oldCsrfResponse.resolve(jsonResponse({ csrfToken: "old-token" }));
  await assert.rejects(() => oldMutation, (error: unknown) => error instanceof ApiError && error.kind === "network");

  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[2]?.init?.headers).get("x-csrf-token"), "new-token");
});

test("a logout request acquires a new-epoch CSRF token while an old mutation remains blocked", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const oldCsrfResponse = deferred<Response>();
  const logoutCsrfResponse = deferred<Response>();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (!String(input).endsWith("/auth/csrf")) return jsonResponse({ status: "ok" });
    return calls.filter((call) => String(call.input).endsWith("/auth/csrf")).length === 1
      ? oldCsrfResponse.promise
      : logoutCsrfResponse.promise;
  });

  const client = createApiClient();
  const oldMutation = client.request("/mutations/old", { method: "POST" });
  client.clearCsrfToken();
  const logout = client.request("/auth/logout", { method: "POST", expectedStatus: 200 });

  logoutCsrfResponse.resolve(jsonResponse({ csrfToken: "logout-token" }));
  await logout;
  oldCsrfResponse.resolve(jsonResponse({ csrfToken: "old-token" }));
  await assert.rejects(() => oldMutation, (error: unknown) => error instanceof ApiError && error.kind === "network");

  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.input, `${apiBaseUrl}/auth/logout`);
  assert.equal(new Headers(calls[2]?.init?.headers).get("x-csrf-token"), "logout-token");
});

test("a protected-request 401 invalidates a pending CSRF acquisition before it can send", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const csrfResponse = deferred<Response>();
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (String(input).endsWith("/auth/csrf")) return csrfResponse.promise;
    if (String(input).endsWith("/auth/me")) return jsonResponse({ message: "Authentication required." }, 401);
    return jsonResponse({ status: "ok" });
  });

  const client = createApiClient();
  const mutation = client.request("/mutations/old", { method: "POST" });
  await assert.rejects(
    () => client.request("/auth/me"),
    (error: unknown) => error instanceof ApiError && error.kind === "unauthorized",
  );
  csrfResponse.resolve(jsonResponse({ csrfToken: "late-token" }));

  await assert.rejects(() => mutation, (error: unknown) => error instanceof ApiError && error.kind === "network");
  assert.equal(calls.length, 2);
});

test("a CSRF acquisition 401 clears its epoch and cannot leave a reusable token", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const events: string[] = [];
  const unsubscribe = subscribeToApiSessionEvents((event) => events.push(event));
  t.after(unsubscribe);
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (String(input).endsWith("/auth/csrf")) {
      return calls.filter((call) => String(call.input).endsWith("/auth/csrf")).length === 1
        ? jsonResponse({ message: "Authentication required." }, 401)
        : jsonResponse({ csrfToken: "fresh-token" });
    }
    return jsonResponse({ status: "ok" });
  });

  const client = createApiClient();
  await assert.rejects(
    () => client.request("/mutations/old", { method: "POST" }),
    (error: unknown) => error instanceof ApiError && error.kind === "unauthorized",
  );
  await client.request("/mutations/new", { method: "POST" });

  assert.deepEqual(events, ["unauthorized"]);
  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[2]?.init?.headers).get("x-csrf-token"), "fresh-token");
});

test("a failed CSRF acquisition can be retried without caching its failure", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  installFetch(t, async (input, init) => {
    calls.push({ input, init });
    if (String(input).endsWith("/auth/csrf")) {
      return calls.filter((call) => String(call.input).endsWith("/auth/csrf")).length === 1
        ? jsonResponse({ message: "Temporary failure." }, 500)
        : jsonResponse({ csrfToken: "retry-token" });
    }
    return jsonResponse({ status: "ok" });
  });

  const client = createApiClient();
  await assert.rejects(() => client.request("/mutations/first", { method: "POST" }));
  await client.request("/mutations/second", { method: "POST" });

  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[2]?.init?.headers).get("x-csrf-token"), "retry-token");
});

test("CSRF acquisition accepts only the exact documented 200 response", async (t) => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
  });
  const invalidResponses = [
    jsonResponse({}),
    jsonResponse({ csrfToken: "token", extra: true }),
    jsonResponse({ csrfToken: 1 }),
    jsonResponse({ csrfToken: "   " }),
    jsonResponse({ csrfToken: "token" }, 201),
  ];
  installFetch(t, async () => invalidResponses.shift() ?? jsonResponse({ csrfToken: "token" }));

  const client = createApiClient();
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      () => client.request(`/mutations/${index}`, { method: "POST" }),
      (error: unknown) => error instanceof ApiError && error.kind === "server",
    );
  }
});
