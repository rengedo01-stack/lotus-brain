export type AuthenticationApi = {
  request<T>(path: string): Promise<T>;
};

export type CurrentUser = {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  status: string;
  updatedAt: string;
};

export type OperationalAuthentication = {
  permissions: ReadonlySet<string>;
  user: CurrentUser;
};

export class AuthenticationBootstrapCoordinator {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
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
    api.request<unknown>("/auth/me"),
    api.request<unknown>("/auth/me/permissions"),
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
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.displayName === "string" &&
    typeof user.status === "string" &&
    (typeof user.lastLoginAt === "string" || user.lastLoginAt === null) &&
    typeof user.createdAt === "string" &&
    typeof user.updatedAt === "string"
  );
}

function isMeResponse(value: unknown): value is { user: CurrentUser } {
  return typeof value === "object" && value !== null && isCurrentUser((value as { user?: unknown }).user);
}

function isPermissionsResponse(value: unknown): value is { permissions: string[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { permissions?: unknown }).permissions) &&
    (value as { permissions: unknown[] }).permissions.every((permission) => typeof permission === "string")
  );
}
