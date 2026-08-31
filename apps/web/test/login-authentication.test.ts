import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/api-client.ts";
import {
  activatePendingSession,
  completeLoginResponse,
  isAuthenticatedLoginResponse,
  isMfaRequiredLoginResponse,
  isSessionActivationResponse,
  LoginResponseContractError,
  SessionActivationAmbiguityError,
} from "../lib/login-authentication.ts";

const authenticatedLogin = {
  user: {
    id: "user-1",
    email: "staff@example.test",
    displayName: "Staff",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  },
  csrfToken: "csrf-token",
};

const mfaRequiredLogin = {
  status: "MFA_REQUIRED",
  options: { challenge: "webauthn-challenge" },
  preAuthCsrfToken: "mfa-preauth-csrf-token",
};

test("accepts only the exact authenticated login response contract", () => {
  assert.equal(isAuthenticatedLoginResponse(authenticatedLogin), true);
  assert.equal(isAuthenticatedLoginResponse({ ...authenticatedLogin, status: "AUTHENTICATED" }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { ...authenticatedLogin.user, status: "DISABLED" },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { ...authenticatedLogin.user, status: "LOCKED" },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({ user: authenticatedLogin.user }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { ...authenticatedLogin.user, passwordHash: "must-not-be-accepted" },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { ...authenticatedLogin.user, displayName: 42 },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { ...authenticatedLogin.user, updatedAt: "2026-08-30" },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({
    ...authenticatedLogin,
    user: { id: authenticatedLogin.user.id, email: authenticatedLogin.user.email },
  }), false);
  assert.equal(isAuthenticatedLoginResponse({ ...authenticatedLogin, csrfToken: "" }), false);
  assert.equal(isAuthenticatedLoginResponse(null), false);
});

test("accepts only the exact and actionable MFA_REQUIRED response contract", () => {
  assert.equal(isMfaRequiredLoginResponse(mfaRequiredLogin), true);
  assert.equal(isMfaRequiredLoginResponse({ ...mfaRequiredLogin, user: authenticatedLogin.user }), false);
  assert.equal(isMfaRequiredLoginResponse({ ...mfaRequiredLogin, status: "AUTHENTICATED" }), false);
  assert.equal(isMfaRequiredLoginResponse({ ...mfaRequiredLogin, preAuthCsrfToken: "" }), false);
  assert.equal(isMfaRequiredLoginResponse({ ...mfaRequiredLogin, options: {} }), false);
  assert.equal(isMfaRequiredLoginResponse({ ...mfaRequiredLogin, options: { challenge: "" } }), false);
  assert.equal(isMfaRequiredLoginResponse([]), false);
});

test("accepts only the exact session activation response contract", () => {
  assert.equal(isSessionActivationResponse({ status: "ok" }), true);
  assert.equal(isSessionActivationResponse({ status: "ok", user: authenticatedLogin.user }), false);
  assert.equal(isSessionActivationResponse({ status: "activated" }), false);
  assert.equal(isSessionActivationResponse(null), false);
});

test("activation uses the response-bound proof directly and makes no bootstrap request", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      return { status: "ok" } as T;
    },
  };

  await activatePendingSession(api, authenticatedLogin);
  assert.deepEqual(calls, [{
    path: "/auth/session/activate",
    options: {
      method: "POST",
      headers: { "x-csrf-token": "csrf-token" },
      csrf: "none",
    },
  }]);
});

test("an unexpected activation 2xx is ambiguous and triggers only CSRF-bound best-effort logout", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      if (path === "/auth/session/activate") return { status: "ok", extra: "unexpected" } as T;
      if (path === "/auth/logout") return { status: "ok" } as T;
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  await assert.rejects(
    () => activatePendingSession(api, authenticatedLogin),
    SessionActivationAmbiguityError,
  );
  assert.deepEqual(calls, [
    {
      path: "/auth/session/activate",
      options: {
        method: "POST",
        headers: { "x-csrf-token": "csrf-token" },
        csrf: "none",
      },
    },
    {
      path: "/auth/logout",
      options: {
        method: "POST",
        headers: { "x-csrf-token": "csrf-token" },
        csrf: "none",
      },
    },
  ]);
});

test("activation 401, 403, and 409 remain explicit safe login failures", async () => {
  for (const error of [
    new ApiError("unauthorized", 401),
    new ApiError("forbidden", 403),
    new ApiError("conflict", 409),
  ]) {
    const calls: string[] = [];
    const api = {
      async request<T>(path: string): Promise<T> {
        calls.push(path);
        throw error;
      },
    };
    await assert.rejects(() => activatePendingSession(api, authenticatedLogin), (actual: unknown) => actual === error);
    assert.deepEqual(calls, ["/auth/session/activate"]);
  }
});

test("network ambiguity after activation is never treated as pending and attempts bounded cleanup", async () => {
  const calls: string[] = [];
  const api = {
    async request<T>(path: string): Promise<T> {
      calls.push(path);
      throw new ApiError("network");
    },
  };
  await assert.rejects(
    () => activatePendingSession(api, authenticatedLogin),
    SessionActivationAmbiguityError,
  );
  assert.deepEqual(calls, ["/auth/session/activate", "/auth/logout"]);
});

test("a malformed MFA response cannot start WebAuthn or activate a session", async () => {
  let passkeyStarts = 0;
  let requests = 0;
  const api = {
    async request<T>(): Promise<T> {
      requests += 1;
      throw new Error("The malformed response must stop before any request.");
    },
  };

  await assert.rejects(
    () => completeLoginResponse(api, { ...mfaRequiredLogin, options: {} }, async () => {
      passkeyStarts += 1;
      return {};
    }),
    LoginResponseContractError,
  );
  assert.equal(passkeyStarts, 0);
  assert.equal(requests, 0);
});

test("a malformed normal login response cannot activate a pending cookie", async () => {
  let requests = 0;
  await assert.rejects(
    () => completeLoginResponse({
      async request<T>(): Promise<T> {
        requests += 1;
        throw new Error("Malformed login must stop before activation.");
      },
    }, { ...authenticatedLogin, extra: "unexpected" }, async () => ({ id: "assertion" })),
    LoginResponseContractError,
  );
  assert.equal(requests, 0);
});

test("a non-ACTIVE normal login response cannot activate a pending cookie", async () => {
  let requests = 0;
  await assert.rejects(
    () => completeLoginResponse({
      async request<T>(): Promise<T> {
        requests += 1;
        throw new Error("A non-ACTIVE login response must stop before activation.");
      },
    }, {
      ...authenticatedLogin,
      user: { ...authenticatedLogin.user, status: "DISABLED" },
    }, async () => ({ id: "assertion" })),
    LoginResponseContractError,
  );
  assert.equal(requests, 0);
});

test("MFA verification is strictly validated before the pending session is activated", async () => {
  const calls: Array<{ path: string; options: unknown }> = [];
  let passkeyOptions: unknown;
  const api = {
    async request<T>(path: string, options: unknown): Promise<T> {
      calls.push({ path, options });
      if (path === "/auth/login/passkey/verify") return authenticatedLogin as T;
      if (path === "/auth/session/activate") return { status: "ok" } as T;
      throw new Error(`Unexpected request: ${path}`);
    },
  };

  await completeLoginResponse(api, mfaRequiredLogin, async (options) => {
    passkeyOptions = options;
    return { id: "assertion" };
  });

  assert.deepEqual(passkeyOptions, mfaRequiredLogin.options);
  assert.deepEqual(calls, [
    {
      path: "/auth/login/passkey/verify",
      options: {
        method: "POST",
        headers: { "x-csrf-token": "mfa-preauth-csrf-token" },
        body: { response: { id: "assertion" } },
        csrf: "none",
      },
    },
    {
      path: "/auth/session/activate",
      options: {
        method: "POST",
        headers: { "x-csrf-token": "csrf-token" },
        csrf: "none",
      },
    },
  ]);
});

test("a malformed MFA verify response cannot activate the pending session", async () => {
  const calls: string[] = [];
  const api = {
    async request<T>(path: string): Promise<T> {
      calls.push(path);
      return { user: authenticatedLogin.user, csrfToken: "csrf-token", extra: "unexpected" } as T;
    },
  };

  await assert.rejects(
    () => completeLoginResponse(api, mfaRequiredLogin, async () => ({ id: "assertion" })),
    LoginResponseContractError,
  );
  assert.deepEqual(calls, ["/auth/login/passkey/verify"]);
});

test("a non-ACTIVE MFA verify response cannot activate the pending session", async () => {
  const calls: string[] = [];
  const api = {
    async request<T>(path: string): Promise<T> {
      calls.push(path);
      return {
        ...authenticatedLogin,
        user: { ...authenticatedLogin.user, status: "LOCKED" },
      } as T;
    },
  };

  await assert.rejects(
    () => completeLoginResponse(api, mfaRequiredLogin, async () => ({ id: "assertion" })),
    LoginResponseContractError,
  );
  assert.deepEqual(calls, ["/auth/login/passkey/verify"]);
});

test("the public login route is never cacheable or a referrer source", async () => {
  const nextConfig = (await import("../next.config.ts")).default as {
    headers?: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
  };
  assert.ok(nextConfig.headers);
  const headers = await nextConfig.headers();
  const login = headers.find((entry) => entry.source === "/login");
  assert.deepEqual(login?.headers, [
    { key: "Cache-Control", value: "no-store" },
    { key: "Referrer-Policy", value: "no-referrer" },
  ]);
});
