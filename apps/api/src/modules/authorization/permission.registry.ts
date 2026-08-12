export const Permissions = Object.freeze({
  AUTHORIZATION_READ: "authorization.read",
  AUTHORIZATION_MANAGE: "authorization.manage",
  MASTER_READ: "master.read",
  MASTER_WRITE: "master.write",
  PURCHASE_READ: "purchase.read",
  PURCHASE_WRITE: "purchase.write",
  PURCHASE_CONFIRM: "purchase.confirm",
  PURCHASE_POST: "purchase.post",
  PRODUCTION_POST: "production.post",
  STOCKTAKE_READ: "stocktake.read",
  STOCKTAKE_WRITE: "stocktake.write",
  STOCKTAKE_CONFIRM: "stocktake.confirm",
  STOCKTAKE_POST: "stocktake.post",
} as const);

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSION_CODES = Object.freeze(Object.values(Permissions)) as readonly PermissionCode[];

const knownPermissionCodes = new Set<string>(ALL_PERMISSION_CODES);

type PermissionMetadata = Readonly<{
  description: string;
  customRoleAssignable: boolean;
}>;

export const PERMISSION_REGISTRY: Readonly<Record<PermissionCode, PermissionMetadata>> = Object.freeze({
  [Permissions.AUTHORIZATION_READ]: Object.freeze({
    description: "Read authorization configuration.",
    customRoleAssignable: true,
  }),
  [Permissions.AUTHORIZATION_MANAGE]: Object.freeze({
    description: "Manage custom authorization policy.",
    customRoleAssignable: false,
  }),
  [Permissions.MASTER_READ]: Object.freeze({ description: "Read master data.", customRoleAssignable: true }),
  [Permissions.MASTER_WRITE]: Object.freeze({ description: "Create or update master data.", customRoleAssignable: true }),
  [Permissions.PURCHASE_READ]: Object.freeze({ description: "Read purchases.", customRoleAssignable: true }),
  [Permissions.PURCHASE_WRITE]: Object.freeze({ description: "Create or update purchase drafts.", customRoleAssignable: true }),
  [Permissions.PURCHASE_CONFIRM]: Object.freeze({ description: "Confirm purchase drafts.", customRoleAssignable: true }),
  [Permissions.PURCHASE_POST]: Object.freeze({ description: "Post purchases.", customRoleAssignable: true }),
  [Permissions.PRODUCTION_POST]: Object.freeze({ description: "Post productions.", customRoleAssignable: true }),
  [Permissions.STOCKTAKE_READ]: Object.freeze({ description: "Read stocktakes.", customRoleAssignable: true }),
  [Permissions.STOCKTAKE_WRITE]: Object.freeze({ description: "Create or update stocktake drafts.", customRoleAssignable: true }),
  [Permissions.STOCKTAKE_CONFIRM]: Object.freeze({ description: "Confirm stocktake drafts.", customRoleAssignable: true }),
  [Permissions.STOCKTAKE_POST]: Object.freeze({ description: "Post stocktakes.", customRoleAssignable: true }),
});

export type PermissionDefinition = Readonly<{ code: PermissionCode } & PermissionMetadata>;

export const ALL_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = Object.freeze(
  ALL_PERMISSION_CODES.map((code) => Object.freeze({ code, ...PERMISSION_REGISTRY[code] })),
);

export function isKnownPermissionCode(value: string): value is PermissionCode {
  return knownPermissionCodes.has(value);
}

export function getPermissionDefinition(code: PermissionCode): PermissionDefinition {
  return Object.freeze({ code, ...PERMISSION_REGISTRY[code] });
}
