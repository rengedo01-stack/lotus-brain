export const Permissions = Object.freeze({
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

export function isKnownPermissionCode(value: string): value is PermissionCode {
  return knownPermissionCodes.has(value);
}
