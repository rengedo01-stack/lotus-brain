-- Inventory visibility is a read-only capability. The frozen legacy role
-- retains its rollout snapshot; SYSTEM_ADMIN receives newly introduced
-- application permissions without assigning that role to any user.
INSERT INTO "Permission" ("id", "code", "description") VALUES
  ('rbac-permission-inventory-read', 'inventory.read', 'Read current inventory and inventory history.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT "Role"."id", "Permission"."id"
FROM "Role"
JOIN "Permission" ON "Permission"."code" = 'inventory.read'
WHERE "Role"."code" = 'SYSTEM_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Stable keyset pagination for a product's newest-first ledger. The existing
-- ascending index remains during this forward-only rollout.
CREATE INDEX "InventoryHistory_inventoryId_occurredAt_id_desc_idx"
ON "InventoryHistory" ("inventoryId", "occurredAt" DESC, "id" DESC);

-- Keeps an optional transaction-type filter indexable without changing the
-- immutable inventory accounting records themselves.
CREATE INDEX "InventoryHistory_inventoryId_type_occurredAt_id_desc_idx"
ON "InventoryHistory" ("inventoryId", "type", "occurredAt" DESC, "id" DESC);
