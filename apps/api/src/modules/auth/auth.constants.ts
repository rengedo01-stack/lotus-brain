export const AUTH_PUBLIC_KEY = "auth:public";
export const AUTH_CSRF_EXEMPT_KEY = "auth:csrfExempt";
export const AUTH_PENDING_SESSION_ACTIVATION_KEY = "auth:pendingSessionActivation";

export const SESSION_COOKIE_NAME = "__Host-lotus_session";
export const SESSION_COOKIE_NAME_INSECURE = "lotus_session";
export const MFA_PREAUTH_COOKIE_NAME = "__Host-lotus_mfa_preauth";
export const MFA_PREAUTH_COOKIE_NAME_INSECURE = "lotus_mfa_preauth";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_COOKIE_NAME = "XSRF-TOKEN";

export const AUTH_SESSION_TTL_DAYS = 7;
export const PENDING_SESSION_TTL_MS = 5 * 60 * 1_000;
export const PASSKEY_MFA_TRANSACTION_TTL_MS = 5 * 60 * 1_000;
export const PASSKEY_STEP_UP_TTL_MS = 5 * 60 * 1_000;
export const LOGIN_THROTTLE_LIMIT = 5;
export const LOGIN_THROTTLE_TTL_MS = 60_000;
export const OPAQUE_TOKEN_BYTES = 32;
