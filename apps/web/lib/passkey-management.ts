import type { ApiClient, ApiRequestOptions } from "./api-client";

export type PasskeyView = {
  backedUp: boolean | null;
  createdAt: string;
  deviceType: string | null;
  displayName: string | null;
  id: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  transports: string[];
  updatedAt: string;
};

export type PasskeyManagementApi = Pick<ApiClient, "request">;

const PASSKEY_VIEW_KEYS = [
  "backedUp",
  "createdAt",
  "deviceType",
  "displayName",
  "id",
  "lastUsedAt",
  "revokedAt",
  "transports",
  "updatedAt",
] as const;

const PASSKEY_MUTATION_RESPONSE_KEYS = ["passkey"] as const;
const PASSKEY_DEVICE_TYPES = new Set(["singleDevice", "multiDevice"]);
const PASSKEY_TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);

export const passkeyPaths = {
  list: "/auth/passkeys",
  registrationOptions: "/auth/passkeys/registration/options",
  registrationVerify: "/auth/passkeys/registration/verify",
} as const;

export function passkeyRenamePath(passkeyId: string): string {
  return `${passkeyPaths.list}/${encodeURIComponent(passkeyId)}`;
}

export function passkeyRevokePath(passkeyId: string): string {
  return `${passkeyRenamePath(passkeyId)}/revoke`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

export function isPasskeyView(value: unknown): value is PasskeyView {
  if (!isRecord(value) || !hasExactlyKeys(value, PASSKEY_VIEW_KEYS)) return false;
  const passkey = value as PasskeyView;
  return (
    typeof passkey.id === "string" && passkey.id.length > 0 &&
    (typeof passkey.displayName === "string" || passkey.displayName === null) &&
    Array.isArray(passkey.transports) && passkey.transports.every((transport) => typeof transport === "string" && PASSKEY_TRANSPORTS.has(transport)) &&
    (passkey.deviceType === null || PASSKEY_DEVICE_TYPES.has(passkey.deviceType)) &&
    (typeof passkey.backedUp === "boolean" || passkey.backedUp === null) &&
    isIsoTimestamp(passkey.createdAt) &&
    isIsoTimestamp(passkey.updatedAt) &&
    (passkey.lastUsedAt === null || isIsoTimestamp(passkey.lastUsedAt)) &&
    (passkey.revokedAt === null || isIsoTimestamp(passkey.revokedAt))
  );
}

export function isPasskeyList(value: unknown): value is PasskeyView[] {
  if (!Array.isArray(value) || !value.every(isPasskeyView)) return false;
  const ids = new Set(value.map((passkey) => passkey.id));
  return ids.size === value.length;
}

export function isPasskeyMutationResponse(value: unknown): value is { passkey: PasskeyView } {
  return isRecord(value)
    && hasExactlyKeys(value, PASSKEY_MUTATION_RESPONSE_KEYS)
    && isPasskeyView(value.passkey);
}

/**
 * These settings views are trusted only after the API client has confirmed
 * their documented 200 response. The helpers deliberately do not refresh the
 * list: a mutation response is the source of truth for its local update.
 */
export async function requestPasskeyList(api: PasskeyManagementApi): Promise<PasskeyView[]> {
  const payload = await api.request<unknown>(passkeyPaths.list, { expectedStatus: 200 });
  if (!isPasskeyList(payload)) throw new Error("Passkeys could not be loaded.");
  return payload;
}

export async function requestPasskeyMutation(
  api: PasskeyManagementApi,
  path: string,
  options: ApiRequestOptions,
): Promise<{ passkey: PasskeyView }> {
  const payload = await api.request<unknown>(path, { ...options, expectedStatus: 200 });
  if (!isPasskeyMutationResponse(payload)) throw new Error("Unexpected passkey mutation response.");
  return payload;
}

function sortPasskeys(passkeys: PasskeyView[]): PasskeyView[] {
  return [...passkeys].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function addPasskeyFromResponse(passkeys: PasskeyView[], passkey: PasskeyView): PasskeyView[] {
  const withoutExisting = passkeys.filter((item) => item.id !== passkey.id);
  return sortPasskeys([...withoutExisting, passkey]);
}

export function replacePasskeyFromResponse(passkeys: PasskeyView[], passkey: PasskeyView): PasskeyView[] {
  return passkeys.map((item) => item.id === passkey.id ? passkey : item);
}

export function isCurrentPasskeyListResponse(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}
