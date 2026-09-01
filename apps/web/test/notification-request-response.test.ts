import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../lib/api-client.ts";
import { requestEmailVerification } from "../lib/email-verification.ts";
import { requestPasswordRecovery } from "../lib/password-recovery.ts";
import { resendUserInvitation } from "../lib/user-invitations.ts";

const apiBaseUrl = "https://api.example.test/api/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function malformedJsonResponse(status = 202): Response {
  return new Response("{", {
    headers: { "content-type": "application/json" },
    status,
  });
}

function installFetch(
  t: Parameters<typeof test>[1] extends (context: infer Context) => unknown ? Context : never,
  response: Response,
): string[] {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  process.env.NEXT_PUBLIC_API_BASE_URL = apiBaseUrl;
  globalThis.fetch = async (input) => {
    const path = String(input);
    paths.push(path);
    return path.endsWith("/auth/csrf") ? jsonResponse({ csrfToken: "test-csrf-token" }) : response;
  };
  t.after(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
    globalThis.fetch = originalFetch;
  });
  return paths;
}

for (const target of [
  { expectedPath: `${apiBaseUrl}/auth/password/recovery/request`, name: "password recovery request", requiresCsrf: false, invoke: (api: ReturnType<typeof createApiClient>) => requestPasswordRecovery(api, { email: "recovery@example.test" }) },
  { expectedPath: `${apiBaseUrl}/auth/email/verification/request`, name: "email verification request", requiresCsrf: true, invoke: (api: ReturnType<typeof createApiClient>) => requestEmailVerification(api) },
  { expectedPath: `${apiBaseUrl}/identity/invitations/invitation-1/resend`, name: "invitation resend", requiresCsrf: true, invoke: (api: ReturnType<typeof createApiClient>) => resendUserInvitation(api, "invitation-1") },
] as const) {
  test(`${target.name} accepts only its exact 202 response contract`, async (t) => {
    const paths = installFetch(t, jsonResponse({ status: "accepted" }, 202));
    const result = await target.invoke(createApiClient());
    assert.deepEqual(result, { status: "accepted" });
    assert.deepEqual(paths, target.requiresCsrf
      ? [`${apiBaseUrl}/auth/csrf`, target.expectedPath]
      : [target.expectedPath]);
  });

  for (const status of [200, 201, 204]) {
    test(`${target.name} rejects unexpected ${status}`, async (t) => {
      const paths = installFetch(t, status === 204 ? new Response(null, { status }) : jsonResponse({ status: "accepted" }, status));
      await assert.rejects(
        () => target.invoke(createApiClient()),
        (error: unknown) => error instanceof ApiError && error.kind === "server" && error.status === status,
      );
      assert.equal(paths.at(-1), target.expectedPath);
    });
  }

  for (const [label, response] of [
    ["missing status", jsonResponse({}, 202)],
    ["wrong status", jsonResponse({ status: "ok" }, 202)],
    ["wrong status type", jsonResponse({ status: 202 }, 202)],
    ["extra root field", jsonResponse({ status: "accepted", extra: true }, 202)],
    ["malformed JSON", malformedJsonResponse(202)],
  ] as const) {
    test(`${target.name} rejects ${label} at HTTP 202`, async (t) => {
      installFetch(t, response);
      await assert.rejects(
        () => target.invoke(createApiClient()),
        (error: unknown) => error instanceof Error,
      );
    });
  }
}
