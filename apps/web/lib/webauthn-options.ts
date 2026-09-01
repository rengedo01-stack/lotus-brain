import type { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { ApiClient } from "./api-client";

export type WebAuthnRegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
export type WebAuthnAuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];
export type WebAuthnOptionsApi = Pick<ApiClient, "request">;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const AUTHENTICATOR_ATTACHMENTS = new Set(["cross-platform", "platform"]);
const ATTESTATION_PREFERENCES = new Set(["direct", "enterprise", "indirect", "none"]);
const RESIDENT_KEY_REQUIREMENTS = new Set(["discouraged", "preferred", "required"]);
const USER_VERIFICATION_REQUIREMENTS = new Set(["discouraged", "preferred", "required"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBase64Url(value: unknown): value is string {
  return isNonEmptyString(value) && BASE64URL.test(value);
}

function isTimeout(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xFFFF_FFFF;
}

function isOptional(value: Record<string, unknown>, key: string, validator: (candidate: unknown) => boolean): boolean {
  return !hasOwn(value, key) || validator(value[key]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isCredentialDescriptor(value: unknown): boolean {
  if (!isRecord(value) || !isBase64Url(value.id) || value.type !== "public-key") return false;

  // `transports` is a hint. Keep new standard transport strings pass-through
  // compatible while rejecting non-string JSON values before WebAuthn sees them.
  return isOptional(value, "transports", isStringArray);
}

function isCredentialDescriptorList(value: unknown, minimumLength: number): boolean {
  if (!Array.isArray(value) || value.length < minimumLength || !value.every(isCredentialDescriptor)) return false;
  const identifiers = value.map((credential) => (credential as Record<string, unknown>).id as string);
  return new Set(identifiers).size === identifiers.length;
}

function isAuthenticatorSelection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isOptional(value, "authenticatorAttachment", (candidate) =>
      typeof candidate === "string" && AUTHENTICATOR_ATTACHMENTS.has(candidate)) &&
    isOptional(value, "requireResidentKey", (candidate) => typeof candidate === "boolean") &&
    isOptional(value, "residentKey", (candidate) =>
      typeof candidate === "string" && RESIDENT_KEY_REQUIREMENTS.has(candidate)) &&
    isOptional(value, "userVerification", (candidate) =>
      typeof candidate === "string" && USER_VERIFICATION_REQUIREMENTS.has(candidate))
  );
}

function isExtensions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // Validate the currently known extension inputs when present, while keeping
  // unknown extension keys and their values intact for WebAuthn evolution.
  return (
    isOptional(value, "appid", isNonEmptyString) &&
    isOptional(value, "credProps", (candidate) => typeof candidate === "boolean") &&
    isOptional(value, "hmacCreateSecret", (candidate) => typeof candidate === "boolean") &&
    isOptional(value, "minPinLength", (candidate) => typeof candidate === "boolean")
  );
}

function isRegistrationRp(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.name);
}

function isRegistrationUser(value: unknown): boolean {
  return isRecord(value) && isBase64Url(value.id) && isNonEmptyString(value.name) && typeof value.displayName === "string";
}

function isCredentialParameter(value: unknown): boolean {
  return isRecord(value) && value.type === "public-key" && typeof value.alg === "number" && Number.isInteger(value.alg);
}

/**
 * Checks the generated registration option fields needed to safely start a
 * ceremony. Unknown root and nested extension fields intentionally remain in
 * the original object and are passed to SimpleWebAuthn unchanged.
 */
export function isWebAuthnRegistrationOptions(value: unknown): value is WebAuthnRegistrationOptions {
  if (!isRecord(value)) return false;
  if (
    !isBase64Url(value.challenge) ||
    !isRegistrationRp(value.rp) ||
    !isRegistrationUser(value.user) ||
    !Array.isArray(value.pubKeyCredParams) ||
    value.pubKeyCredParams.length === 0 ||
    !value.pubKeyCredParams.every(isCredentialParameter)
  ) return false;

  return (
    isOptional(value, "timeout", isTimeout) &&
    isOptional(value, "excludeCredentials", (candidate) => isCredentialDescriptorList(candidate, 0)) &&
    isOptional(value, "authenticatorSelection", isAuthenticatorSelection) &&
    isOptional(value, "hints", isStringArray) &&
    isOptional(value, "attestation", (candidate) => typeof candidate === "string" && ATTESTATION_PREFERENCES.has(candidate)) &&
    isOptional(value, "attestationFormats", isStringArray) &&
    isOptional(value, "extensions", isExtensions)
  );
}

/**
 * MFA authentication options are user-bound in Lotus BRAIN, so their RP ID
 * and credential descriptors are required in addition to a non-empty
 * challenge. Other known WebAuthn fields stay optional and extension fields
 * are deliberately left pass-through compatible.
 */
export function isWebAuthnAuthenticationOptions(value: unknown): value is WebAuthnAuthenticationOptions {
  if (!isRecord(value)) return false;
  if (!isBase64Url(value.challenge) || !isNonEmptyString(value.rpId) || !isCredentialDescriptorList(value.allowCredentials, 1)) {
    return false;
  }

  return (
    isOptional(value, "timeout", isTimeout) &&
    isOptional(value, "userVerification", (candidate) =>
      typeof candidate === "string" && USER_VERIFICATION_REQUIREMENTS.has(candidate)) &&
    isOptional(value, "hints", isStringArray) &&
    isOptional(value, "extensions", isExtensions)
  );
}

export async function requestWebAuthnRegistrationOptions(
  api: WebAuthnOptionsApi,
  path: string,
  currentPassword: string,
): Promise<WebAuthnRegistrationOptions> {
  const options = await api.request<unknown>(path, {
    method: "POST",
    body: { currentPassword },
    expectedStatus: 200,
  });
  if (!isWebAuthnRegistrationOptions(options)) throw new Error("Unexpected passkey registration options response.");
  return options;
}

export async function requestWebAuthnAuthenticationOptions(
  api: WebAuthnOptionsApi,
  path: string,
  currentPassword: string,
): Promise<WebAuthnAuthenticationOptions> {
  const options = await api.request<unknown>(path, {
    method: "POST",
    body: { currentPassword },
    expectedStatus: 200,
  });
  if (!isWebAuthnAuthenticationOptions(options)) throw new Error("Unexpected passkey authentication options response.");
  return options;
}
