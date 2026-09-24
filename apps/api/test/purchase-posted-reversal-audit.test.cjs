const test = require("node:test");
const assert = require("node:assert/strict");
const { ForbiddenException, UnauthorizedException } = require("@nestjs/common");

const { PurchaseController } = require("../dist/modules/purchase/presentation/purchase.controller.js");
const { PurchasePostedReversalService } = require("../dist/modules/purchase/application/purchase-posted-reversal.service.js");
const { PurchasePostedReversalNotFoundError } = require("../dist/modules/purchase/application/purchase-posted-reversal.errors.js");
const { PrismaPurchasePostedReversalRepository } = require("../dist/modules/purchase/infrastructure/prisma-purchase-posted-reversal.repository.js");
const { AuthorizationGuard } = require("../dist/modules/authorization/guards/authorization.guard.js");
const { REQUIRED_PERMISSIONS_KEY } = require("../dist/modules/authorization/authorization.constants.js");
const { Permissions } = require("../dist/modules/authorization/permission.registry.js");
const { purchaseReversalAuditResponseSchema } = require("../dist/modules/purchase/presentation/purchase-response.schemas.js");

const audit = {
  id: "reversal-1",
  purchaseId: "purchase-1",
  actorUserId: "actor-1",
  reason: "duplicate supplier receipt",
  reversedAt: new Date("2026-09-24T00:00:00.000Z"),
  items: [{
    purchaseItemId: "purchase-item-1",
    productId: "product-1",
    inventoryUnitId: "unit-1",
    quantity: "10.000000000",
    unitPrice: "12.345678",
    currency: "JPY",
  }],
  inventoryEffects: [{
    productId: "product-1",
    inventoryId: "inventory-1",
    inventoryUnitId: "unit-1",
    quantityDelta: "-10.000000000",
    quantityAfter: "15.000000000",
    averageUnitCost: "12.345678",
  }],
  priceEffects: [{
    priceMasterId: "price-master-1",
    source: "ORIGINAL_PURCHASE_CURRENT",
    previousCurrentPriceHistoryId: "price-history-1",
    previousVersion: 4,
    appliedUnitPrice: "12.345678",
    appliedCurrency: "JPY",
    effectiveAt: new Date("2026-09-24T00:00:00.000Z"),
    becomesCurrent: true,
    priceHistoryId: "price-history-2",
  }],
};

function controller(readAudit) {
  return new PurchaseController({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, new PurchasePostedReversalService({ readAudit }));
}

function auditContext(request) {
  return {
    switchToHttp() { return { getRequest() { return request; } }; },
    getHandler() { return PurchaseController.prototype.getPurchaseReversalAudit; },
    getClass() { return PurchaseController; },
  };
}

const reflector = {
  getAllAndOverride(key, targets) {
    for (const target of targets) {
      const value = Reflect.getMetadata(key, target);
      if (value !== undefined) return value;
    }
    return undefined;
  },
};

test("purchase reversal audit distinguishes a missing Purchase from an existing Purchase without a reversal", async () => {
  const existing = controller(async () => null);
  assert.deepEqual(await existing.getPurchaseReversalAudit("purchase-1"), { reversal: null });

  const missing = controller(async () => { throw new PurchasePostedReversalNotFoundError("missing"); });
  await assert.rejects(
    () => missing.getPurchaseReversalAudit("missing"),
    (error) => error?.name === "NotFoundException",
  );
});

test("purchase reversal audit returns only the immutable exact wrapper and Swagger schema", async () => {
  const response = await controller(async () => audit).getPurchaseReversalAudit("purchase-1");
  assert.deepEqual(Object.keys(response), ["reversal"]);
  assert.equal(response.reversal.actorUserId, "actor-1");
  assert.equal(response.reversal.priceEffects[0].priceHistoryId, "price-history-2");
  assert.equal(purchaseReversalAuditResponseSchema.additionalProperties, false);
  assert.deepEqual(purchaseReversalAuditResponseSchema.required, ["reversal"]);
  const reversalSchema = purchaseReversalAuditResponseSchema.properties.reversal.oneOf[0];
  assert.equal(reversalSchema.additionalProperties, false);
  assert.equal(reversalSchema.properties.items.items.additionalProperties, false);
  assert.equal(reversalSchema.properties.inventoryEffects.items.additionalProperties, false);
  assert.equal(reversalSchema.properties.priceEffects.items.additionalProperties, false);
});

test("purchase reversal audit route requires exactly its three read permissions and the shared guard returns 401 or 403", async () => {
  const required = [Permissions.PURCHASE_READ, Permissions.INVENTORY_READ, Permissions.MASTER_READ];
  assert.deepEqual(
    Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PurchaseController.prototype.getPurchaseReversalAudit),
    required,
  );

  const permitted = new AuthorizationGuard(reflector, { async hasAllPermissions() { return true; } });
  await assert.rejects(
    () => permitted.canActivate(auditContext({ url: "/purchases/purchase-1/reversal" })),
    UnauthorizedException,
  );

  let requestedPermissions;
  const denied = new AuthorizationGuard(reflector, {
    async hasAllPermissions(_userId, permissions) {
      requestedPermissions = permissions;
      return false;
    },
  });
  await assert.rejects(
    () => denied.canActivate(auditContext({ url: "/purchases/purchase-1/reversal", authUser: { id: "reader" } })),
    ForbiddenException,
  );
  assert.deepEqual(requestedPermissions, required);
});

test("audit repository queries only immutable reversal ledger relations in stable order", async () => {
  let reversalQuery;
  const repository = new PrismaPurchasePostedReversalRepository({
    purchaseReversal: {
      async findUnique(query) {
        reversalQuery = query;
        return null;
      },
    },
    purchase: { async findUnique() { return { id: "purchase-1" }; } },
  });
  assert.equal(await repository.readAudit("purchase-1"), null);
  assert.deepEqual(reversalQuery.select.items.orderBy, { purchaseItemId: "asc" });
  assert.deepEqual(reversalQuery.select.inventoryEffects.orderBy, [{ productId: "asc" }, { inventoryId: "asc" }]);
  assert.deepEqual(reversalQuery.select.priceEffects.orderBy, { priceMasterId: "asc" });
  const selectedLedger = JSON.stringify(reversalQuery.select);
  assert.equal(selectedLedger.includes("displayName"), false);
  assert.equal(selectedLedger.includes("email"), false);
  assert.equal(selectedLedger.includes("purchaseLog"), false);
  assert.equal(selectedLedger.includes("currentUnitPrice"), false);
});
