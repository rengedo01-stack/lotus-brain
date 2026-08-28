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

export function isPasskeyView(value: unknown): value is PasskeyView {
  if (typeof value !== "object" || value === null) return false;
  const passkey = value as Partial<PasskeyView>;
  return (
    typeof passkey.id === "string" && passkey.id.length > 0 &&
    (typeof passkey.displayName === "string" || passkey.displayName === null) &&
    Array.isArray(passkey.transports) && passkey.transports.every((transport) => typeof transport === "string") &&
    (typeof passkey.deviceType === "string" || passkey.deviceType === null) &&
    (typeof passkey.backedUp === "boolean" || passkey.backedUp === null) &&
    typeof passkey.createdAt === "string" &&
    typeof passkey.updatedAt === "string" &&
    (typeof passkey.lastUsedAt === "string" || passkey.lastUsedAt === null) &&
    (typeof passkey.revokedAt === "string" || passkey.revokedAt === null)
  );
}

export function isPasskeyList(value: unknown): value is PasskeyView[] {
  return Array.isArray(value) && value.every(isPasskeyView);
}

export function isPasskeyMutationResponse(value: unknown): value is { passkey: PasskeyView } {
  return typeof value === "object" && value !== null && isPasskeyView((value as { passkey?: unknown }).passkey);
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
