export type AuthenticationApi = {
  request<T>(path: string, options?: { expectedStatus?: number }): Promise<T>;
};

export type CurrentUser = {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  status: "ACTIVE";
  updatedAt: string;
};

export type OperationalPermissionCode =
  | "authorization.read"
  | "authorization.manage"
  | "identity.read"
  | "identity.manage"
  | "master.read"
  | "master.write"
  | "purchase.read"
  | "purchase.write"
  | "purchase.confirm"
  | "purchase.post"
  | "production.read"
  | "production.write"
  | "production.confirm"
  | "production.post"
  | "stocktake.read"
  | "stocktake.write"
  | "stocktake.confirm"
  | "stocktake.post";

// This client-side allowlist mirrors the typed server permission registry. It
// controls only fail-closed bootstrap UX; AuthorizationGuard remains the API
// security boundary for every operation.
const KNOWN_OPERATIONAL_PERMISSION_CODES = new Set<OperationalPermissionCode>([
  "authorization.read",
  "authorization.manage",
  "identity.read",
  "identity.manage",
  "master.read",
  "master.write",
  "purchase.read",
  "purchase.write",
  "purchase.confirm",
  "purchase.post",
  "production.read",
  "production.write",
  "production.confirm",
  "production.post",
  "stocktake.read",
  "stocktake.write",
  "stocktake.confirm",
  "stocktake.post",
]);

export type OperationalAuthentication = {
  permissions: ReadonlySet<string>;
  user: CurrentUser;
};

export class AuthenticationBootstrapCoordinator {
  private generation = 0;
  private sessionTerminationInProgress = false;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  /**
   * A session-termination intent is one-way for the lifetime of this
   * protected document. In particular, a BFCache restoration or an old
   * bootstrap response must never make the authenticated shell visible again.
   * A new login creates a new document and therefore a new coordinator.
   */
  beginSessionTermination(): void {
    this.sessionTerminationInProgress = true;
    this.invalidate();
  }

  isSessionTerminationInProgress(): boolean {
    return this.sessionTerminationInProgress;
  }

  isCurrent(generation: number): boolean {
    return !this.sessionTerminationInProgress && generation === this.generation;
  }
}

export function isBfcacheRestore(event: Pick<PageTransitionEvent, "persisted">): boolean {
  return event.persisted === true;
}

export async function bootstrapOperationalAuthentication(
  api: AuthenticationApi,
  coordinator: AuthenticationBootstrapCoordinator,
  generation: number,
): Promise<OperationalAuthentication | null> {
  const [meResponse, permissionsResponse] = await Promise.all([
    api.request<unknown>("/auth/me", { expectedStatus: 200 }),
    api.request<unknown>("/auth/me/permissions", { expectedStatus: 200 }),
  ]);
  if (!isMeResponse(meResponse) || !isPermissionsResponse(permissionsResponse)) {
    throw new Error("Invalid current authentication response.");
  }
  if (!coordinator.isCurrent(generation)) return null;

  return {
    user: meResponse.user,
    permissions: new Set(permissionsResponse.permissions),
  };
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!isRecord(value)) return false;
  if (!hasExactlyKeys(value, ["id", "email", "displayName", "status", "lastLoginAt", "createdAt", "updatedAt"])) return false;

  // SessionAuthGuard permits this endpoint only for active, non-deleted users.
  // This validates the response contract for bootstrap UX; it is not the
  // application's authorization boundary.
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.email) &&
    isNonEmptyString(value.displayName) &&
    value.status === "ACTIVE" &&
    (value.lastLoginAt === null || isSerializedPrismaDateTime(value.lastLoginAt)) &&
    isSerializedPrismaDateTime(value.createdAt) &&
    isSerializedPrismaDateTime(value.updatedAt)
  );
}

function isMeResponse(value: unknown): value is { user: CurrentUser } {
  return isRecord(value) && hasExactlyKeys(value, ["user"]) && isCurrentUser(value.user);
}

function isPermissionsResponse(value: unknown): value is { permissions: OperationalPermissionCode[] } {
  if (!isRecord(value) || !hasExactlyKeys(value, ["permissions"]) || !Array.isArray(value.permissions)) return false;
  const permissions = value.permissions;
  return permissions.every(isOperationalPermissionCode) && new Set(permissions).size === permissions.length;
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

function isSerializedPrismaDateTime(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  // Dates returned by Nest's JSON serialization of Prisma Date fields use the
  // native Date JSON representation. Checking that exact round-trip avoids
  // accepting malformed values without inventing a narrower custom date rule.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isOperationalPermissionCode(value: unknown): value is OperationalPermissionCode {
  return typeof value === "string" && KNOWN_OPERATIONAL_PERMISSION_CODES.has(value as OperationalPermissionCode);
}
