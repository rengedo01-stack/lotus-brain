import type { startAuthentication } from "@simplewebauthn/browser";

type WebAuthnAuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export type LoginAuthenticationApi = {
  request<T>(path: string, options?: {
    body?: unknown;
    csrf?: "auto" | "none";
    headers?: HeadersInit;
    method?: string;
  }): Promise<T>;
};

export type AuthenticatedLoginUser = {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthenticatedLoginResponse = {
  user: AuthenticatedLoginUser;
  csrfToken: string;
};

export type MfaRequiredLoginResponse = {
  status: "MFA_REQUIRED";
  options: WebAuthnAuthenticationOptions;
  preAuthCsrfToken: string;
};

export class SessionActivationAmbiguityError extends Error {
  constructor() {
    super("Session activation could have completed without a valid response.");
    this.name = "SessionActivationAmbiguityError";
  }
}

export class LoginResponseContractError extends Error {
  constructor() {
    super("Login response does not match the documented contract.");
    this.name = "LoginResponseContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isAuthenticatedLoginUser(value: unknown): value is AuthenticatedLoginUser {
  if (!isRecord(value)) return false;
  if (!hasExactlyKeys(value, ["id", "email", "displayName", "status", "lastLoginAt", "createdAt", "updatedAt"])) return false;

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.email) &&
    isNonEmptyString(value.displayName) &&
    (value.status === "ACTIVE" || value.status === "DISABLED" || value.status === "LOCKED") &&
    (value.lastLoginAt === null || isIsoTimestamp(value.lastLoginAt)) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt)
  );
}

export function isAuthenticatedLoginResponse(value: unknown): value is AuthenticatedLoginResponse {
  if (!isRecord(value)) return false;
  return hasExactlyKeys(value, ["user", "csrfToken"]) && isAuthenticatedLoginUser(value.user) && isNonEmptyString(value.csrfToken);
}

export function isMfaRequiredLoginResponse(value: unknown): value is MfaRequiredLoginResponse {
  if (!isRecord(value)) return false;
  if (!hasExactlyKeys(value, ["status", "options", "preAuthCsrfToken"])) return false;
  if (value.status !== "MFA_REQUIRED" || !isNonEmptyString(value.preAuthCsrfToken) || !isRecord(value.options)) return false;

  return isNonEmptyString(value.options.challenge);
}

export function isSessionActivationResponse(value: unknown): value is { status: "ok" } {
  return isRecord(value) && hasExactlyKeys(value, ["status"]) && value.status === "ok";
}

/**
 * The login response carries the only CSRF proof that is valid for its pending
 * session. This request deliberately opts out of ApiClient's normal CSRF
 * bootstrap because that bootstrap is protected and must return 401 while the
 * session is still pending.
 */
export async function activatePendingSession(
  api: LoginAuthenticationApi,
  authenticated: AuthenticatedLoginResponse,
): Promise<void> {
  try {
    const response = await api.request<unknown>("/auth/session/activate", {
      method: "POST",
      headers: { "x-csrf-token": authenticated.csrfToken },
      csrf: "none",
    });
    if (!isSessionActivationResponse(response)) {
      await discardAmbiguouslyActivatedSession(api, authenticated.csrfToken);
      throw new SessionActivationAmbiguityError();
    }
  } catch (error: unknown) {
    if (error instanceof SessionActivationAmbiguityError) throw error;
    // These concrete responses leave the UI on the unauthenticated login
    // screen. They do not warrant a client-side logout attempt.
    if (isExplicitActivationFailure(error)) throw error;
    // A transport or unexpected server error can occur after the activation
    // transaction committed. Best-effort cleanup uses the same response-bound
    // proof; regardless of its outcome, never treat that case as still-pending.
    await discardAmbiguouslyActivatedSession(api, authenticated.csrfToken);
    throw new SessionActivationAmbiguityError();
  }
}

/**
 * Activation can commit before a malformed 2xx body or a transport failure
 * reaches the browser. The normal CSRF-protected logout endpoint is the only
 * cleanup path: no CSRF exception, GET request, or follow-up success probe is
 * introduced. A pending session receives 401 here; an activated one is
 * revoked. The caller remains at the login screen even if cleanup fails.
 */
async function discardAmbiguouslyActivatedSession(api: LoginAuthenticationApi, csrfToken: string): Promise<void> {
  try {
    await api.request<unknown>("/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      csrf: "none",
    });
  } catch {
    // The login UI is fail-closed independently of cleanup completion.
  }
}

/**
 * Finishes a password-login exchange without allowing a pending session to
 * bootstrap application state. Invalid MFA data is rejected before WebAuthn is
 * invoked; both login completion paths activate only after their success body
 * has passed the exact contract check.
 */
export async function completeLoginResponse(
  api: LoginAuthenticationApi,
  response: unknown,
  authenticateWithPasskey: (options: WebAuthnAuthenticationOptions) => Promise<unknown>,
): Promise<void> {
  if (isAuthenticatedLoginResponse(response)) {
    await activatePendingSession(api, response);
    return;
  }
  if (!isMfaRequiredLoginResponse(response)) throw new LoginResponseContractError();

  const assertion = await authenticateWithPasskey(response.options);
  const verified = await api.request<unknown>("/auth/login/passkey/verify", {
    method: "POST",
    headers: { "x-csrf-token": response.preAuthCsrfToken },
    body: { response: assertion },
    csrf: "none",
  });
  if (!isAuthenticatedLoginResponse(verified)) throw new LoginResponseContractError();
  await activatePendingSession(api, verified);
}

function isExplicitActivationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("kind" in error)) return false;
  const kind = (error as { kind?: unknown }).kind;
  return kind === "unauthorized" || kind === "forbidden" || kind === "conflict";
}
