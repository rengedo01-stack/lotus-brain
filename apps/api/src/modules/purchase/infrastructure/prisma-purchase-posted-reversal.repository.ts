import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type PurchaseReversalPriceEffectSource } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  PurchasePostedReversalConflictError,
  PurchasePostedReversalNotFoundError,
  PurchasePostedReversalValidationError,
} from "../application/purchase-posted-reversal.errors";
import type {
  PriceResolutionInput,
  PurchaseReversalExecution,
  PurchaseReversalPreview,
} from "../application/purchase-posted-reversal.types";

type PurchaseRow = {
  id: string;
  supplierId: string;
  status: "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";
  currency: string;
  documentNumber: string | null;
  postedAt: Date | null;
};
type PurchaseItemRow = {
  id: string;
  productId: string;
  unitId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
};
type PriceMasterRow = {
  id: string;
  productId: string;
  currentPriceHistoryId: string | null;
  currentUnitPrice: Prisma.Decimal;
  currency: string;
  version: number;
};
type InventoryRow = {
  id: string;
  productId: string;
  quantity: Prisma.Decimal;
  version: number;
  averageUnitCost: Prisma.Decimal | null;
};
type ReceiptRow = { productId: string; receiptCount: bigint; lastReceiptAt: Date | null; lastReceiptId: string | null };

type ReversalInspection = {
  preview: PurchaseReversalPreview;
  purchase: PurchaseRow;
  items: PurchaseItemRow[];
  priceMasters: Map<string, PriceMasterRow>;
  inventories: Map<string, InventoryRow>;
  priceSourceKinds: Map<string, PurchaseReversalPreview["priceEffects"][number]["source"]>;
};

export type ExecutePurchasePostedReversalInput = Readonly<{
  purchaseId: string;
  actorUserId: string;
  reason: string;
  previewVersion: string;
  idempotencyKey: string;
  priceResolutions: readonly PriceResolutionInput[];
}>;

@Injectable()
export class PrismaPurchasePostedReversalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async preview(purchaseId: string): Promise<PurchaseReversalPreview> {
    const inspection = await this.prisma.$transaction(
      (transaction) => this.inspect(transaction, purchaseId, false),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (inspection === null) throw new PurchasePostedReversalNotFoundError(`Purchase ${purchaseId} was not found.`);
    return inspection.preview;
  }

  async execute(input: ExecutePurchasePostedReversalInput): Promise<PurchaseReversalExecution> {
    const reason = input.reason.trim();
    if (reason.length === 0) throw new PurchasePostedReversalValidationError("Reversal reason cannot be empty.");
    if (reason.length > 10_000) throw new PurchasePostedReversalValidationError("Reversal reason is too long.");
    const resolutions = this.normalizeResolutions(input.priceResolutions);
    const requestFingerprint = this.hash({
      purchaseId: input.purchaseId,
      reason,
      previewVersion: input.previewVersion,
      priceResolutions: [...resolutions.values()].sort((left, right) => left.productId.localeCompare(right.productId)),
    });

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const replay = await transaction.purchaseReversal.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true, purchaseId: true, reversedAt: true, requestFingerprint: true },
        });
        if (replay !== null) {
          if (replay.requestFingerprint !== requestFingerprint) {
            throw new PurchasePostedReversalConflictError("This idempotency key was already used with a different reversal request.");
          }
          return { id: replay.id, purchaseId: replay.purchaseId, reversedAt: replay.reversedAt, replayed: true };
        }

        const inspection = await this.inspect(transaction, input.purchaseId, true);
        if (inspection === null) throw new PurchasePostedReversalNotFoundError(`Purchase ${input.purchaseId} was not found.`);
        if (!inspection.preview.canReverse) {
          throw new PurchasePostedReversalConflictError(inspection.preview.refusalReasons.join(" "));
        }
        if (inspection.preview.previewVersion !== input.previewVersion) {
          throw new PurchasePostedReversalConflictError("The reversal preview is stale. Refresh the preview before executing.");
        }

        this.assertResolutions(inspection, resolutions);
        const now = new Date();
        const reversal = await transaction.purchaseReversal.create({
          data: {
            purchaseId: inspection.purchase.id,
            actorUserId: input.actorUserId,
            reason,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint,
            previewVersion: input.previewVersion,
            reversedAt: now,
          },
          select: { id: true, purchaseId: true, reversedAt: true },
        });

        await transaction.purchaseReversalItem.createMany({
          data: inspection.items.map((item) => ({
            purchaseReversalId: reversal.id,
            purchaseItemId: item.id,
            productId: item.productId,
            inventoryUnitId: item.unitId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            currency: inspection.purchase.currency,
          })),
        });

        for (const effect of inspection.preview.inventoryEffects) {
          const inventory = inspection.inventories.get(effect.productId);
          if (inventory === undefined || effect.quantityAfter === null || effect.inventoryId === null) {
            throw new PurchasePostedReversalConflictError("Inventory changed while preparing the reversal.");
          }
          const inventoryEffect = await transaction.purchaseReversalInventoryEffect.create({
            data: {
              purchaseReversalId: reversal.id,
              productId: effect.productId,
              inventoryId: inventory.id,
              inventoryUnitId: effect.inventoryUnitId,
              quantityDelta: effect.quantityDelta,
              quantityAfter: effect.quantityAfter,
              averageUnitCost: inventory.averageUnitCost,
            },
            select: { id: true },
          });
          await transaction.inventory.update({
            where: { id: inventory.id },
            data: { quantity: effect.quantityAfter, version: { increment: 1 } },
          });
          await transaction.inventoryHistory.create({
            data: {
              inventoryId: inventory.id,
              sourcePurchaseReversalInventoryEffectId: inventoryEffect.id,
              inventoryUnitId: effect.inventoryUnitId,
              type: "PURCHASE_REVERSAL",
              quantityDelta: effect.quantityDelta,
              quantityAfter: effect.quantityAfter,
              occurredAt: now,
              note: `Posted purchase correction ${inspection.purchase.id}`,
            },
          });
        }

        for (const pricePreview of inspection.preview.priceEffects) {
          const priceMaster = inspection.priceMasters.get(pricePreview.productId);
          if (priceMaster === undefined) throw new PurchasePostedReversalConflictError("PriceMaster changed while preparing the reversal.");
          const source = pricePreview.source as PurchaseReversalPriceEffectSource;
          const resolution = resolutions.get(pricePreview.productId);
          const appliedUnitPrice = pricePreview.requiresPriceResolution ? resolution!.currentUnitPrice : priceMaster.currentUnitPrice.toString();
          const appliedCurrency = pricePreview.requiresPriceResolution ? resolution!.currency : priceMaster.currency;
          const becomesCurrent = pricePreview.requiresPriceResolution;
          const priceEffect = await transaction.purchaseReversalPriceEffect.create({
            data: {
              purchaseReversalId: reversal.id,
              priceMasterId: priceMaster.id,
              source,
              previousCurrentPriceHistoryId: priceMaster.currentPriceHistoryId,
              previousVersion: priceMaster.version,
              appliedUnitPrice,
              appliedCurrency,
              effectiveAt: now,
              becomesCurrent,
            },
            select: { id: true },
          });
          const history = await transaction.priceHistory.create({
            data: {
              priceMasterId: priceMaster.id,
              eventType: "PURCHASE_REVERSAL",
              sourcePurchaseReversalPriceEffectId: priceEffect.id,
              inventoryUnitId: this.inventoryUnitFor(inspection.items, pricePreview.productId),
              unitPrice: appliedUnitPrice,
              currency: appliedCurrency,
              effectiveAt: now,
              note: `Posted purchase correction ${inspection.purchase.id}`,
            },
            select: { id: true },
          });
          if (becomesCurrent) {
            await transaction.priceMaster.update({
              where: { id: priceMaster.id },
              data: {
                currentUnitPrice: appliedUnitPrice,
                currency: appliedCurrency,
                currentPriceEffectiveAt: now,
                currentPriceHistoryId: history.id,
                version: { increment: 1 },
              },
            });
          }
        }

        if (inspection.purchase.documentNumber !== null) {
          const claim = await transaction.purchaseDocumentClaim.findUnique({
            where: { purchaseId: inspection.purchase.id },
            select: { id: true, releasedAt: true },
          });
          if (claim === null || claim.releasedAt !== null) {
            throw new PurchasePostedReversalConflictError("The purchase document claim is not active.");
          }
          await transaction.purchaseDocumentClaim.update({ where: { id: claim.id }, data: { releasedAt: now } });
        }

        await transaction.purchaseLog.create({
          data: {
            purchaseId: inspection.purchase.id,
            sourcePurchaseReversalId: reversal.id,
            eventType: "POSTED_REVERSED",
            fromStatus: "POSTED",
            toStatus: "POSTED",
            note: reason,
            occurredAt: now,
          },
        });
        return { ...reversal, replayed: false };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 20_000,
      });
    } catch (error: unknown) {
      if (error instanceof PurchasePostedReversalNotFoundError
        || error instanceof PurchasePostedReversalConflictError
        || error instanceof PurchasePostedReversalValidationError) throw error;
      if (this.isConcurrencyError(error)) {
        throw new PurchasePostedReversalConflictError("The reversal conflicted with another inventory operation. Refresh the preview and retry.");
      }
      throw error;
    }
  }

  private async inspect(
    transaction: TransactionClient,
    purchaseId: string,
    lock: boolean,
  ): Promise<ReversalInspection | null> {
    const items = await transaction.$queryRaw<PurchaseItemRow[]>(Prisma.sql`
      SELECT "id", "productId", "unitId", "quantity", "unitPrice"
      FROM "PurchaseItem"
      WHERE "purchaseId" = ${purchaseId}
      ORDER BY "id"
      ${lock ? Prisma.sql`FOR NO KEY UPDATE` : Prisma.empty}
    `);
    const purchases = await transaction.$queryRaw<PurchaseRow[]>(Prisma.sql`
      SELECT "id", "supplierId", "status", "currency", "documentNumber", "postedAt"
      FROM "Purchase"
      WHERE "id" = ${purchaseId}
      ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
    `);
    const purchase = purchases[0];
    if (purchase === undefined) return null;

    const existingReversal = await transaction.purchaseReversal.findUnique({
      where: { purchaseId },
      select: { id: true, reversedAt: true },
    });
    const refusalReasons: string[] = [];
    if (purchase.status !== "POSTED") refusalReasons.push("Only POSTED purchases can be corrected.");
    if (existingReversal !== null) refusalReasons.push("This purchase has already been corrected.");
    if (items.length === 0) refusalReasons.push("The posted purchase has no items.");

    const groups = this.groupItems(items);
    const productIds = [...groups.keys()].sort();
    const priceMasters = new Map<string, PriceMasterRow>();
    const inventories = new Map<string, InventoryRow>();
    const priceSourceKinds = new Map<string, PurchaseReversalPreview["priceEffects"][number]["source"]>();
    const inventoryEffects: Array<PurchaseReversalPreview["inventoryEffects"][number]> = [];
    const priceEffects: Array<PurchaseReversalPreview["priceEffects"][number]> = [];

    if (productIds.length > 0) {
      const masters = await transaction.$queryRaw<PriceMasterRow[]>(Prisma.sql`
        SELECT "id", "productId", "currentPriceHistoryId", "currentUnitPrice", "currency", "version"
        FROM "PriceMaster"
        WHERE "supplierId" = ${purchase.supplierId} AND "productId" IN (${Prisma.join(productIds)})
        ORDER BY "id"
        ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
      `);
      for (const master of masters) priceMasters.set(master.productId, master);
      const inventoryRows = await transaction.$queryRaw<InventoryRow[]>(Prisma.sql`
        SELECT "id", "productId", "quantity", "version", "averageUnitCost"
        FROM "Inventory"
        WHERE "productId" IN (${Prisma.join(productIds)})
        ORDER BY "productId"
        ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
      `);
      for (const inventory of inventoryRows) inventories.set(inventory.productId, inventory);

      const sourceItemIds = items.map((item) => item.id);
      const histories = await transaction.priceHistory.findMany({
        where: { sourcePurchaseItemId: { in: sourceItemIds } },
        select: { id: true, sourcePurchaseItemId: true },
      });
      const originalHistoryIds = new Set(histories.map((history) => history.id));
      const receiptRows = await transaction.$queryRaw<ReceiptRow[]>(Prisma.sql`
        SELECT pi."productId", COUNT(ih."id") AS "receiptCount",
          (ARRAY_AGG(ih."occurredAt" ORDER BY ih."occurredAt" DESC, ih."id" DESC))[1] AS "lastReceiptAt",
          (ARRAY_AGG(ih."id" ORDER BY ih."occurredAt" DESC, ih."id" DESC))[1] AS "lastReceiptId"
        FROM "PurchaseItem" pi
        LEFT JOIN "InventoryHistory" ih
          ON ih."sourcePurchaseItemId" = pi."id" AND ih."type"::text = 'RECEIPT'
        WHERE pi."id" IN (${Prisma.join(sourceItemIds)})
        GROUP BY pi."productId"
      `);
      const receipts = new Map(receiptRows.map((row) => [row.productId, row]));
      const documentClaim = purchase.documentNumber === null ? null : await transaction.purchaseDocumentClaim.findUnique({
        where: { purchaseId: purchase.id },
        select: { releasedAt: true },
      });
      if (purchase.documentNumber !== null && (documentClaim === null || documentClaim.releasedAt !== null)) {
        refusalReasons.push("The posted purchase document claim is unavailable.");
      }

      for (const productId of productIds) {
        const group = groups.get(productId)!;
        const quantity = group.quantity;
        const inventory = inventories.get(productId);
        const receipt = receipts.get(productId);
        if (receipt === undefined || Number(receipt.receiptCount) !== group.itemCount || receipt.lastReceiptAt === null || receipt.lastReceiptId === null) {
          refusalReasons.push(`Purchase receipt evidence is incomplete for product ${productId}.`);
        }
        if (inventory === undefined) {
          refusalReasons.push(`Inventory is missing for product ${productId}.`);
          inventoryEffects.push({ productId, inventoryId: null, inventoryVersion: null, inventoryUnitId: group.unitId, quantityDelta: quantity.negated().toString(), quantityAfter: null, averageUnitCost: null });
        } else {
          const after = inventory.quantity.sub(quantity);
          if (after.isNegative()) refusalReasons.push(`Inventory is insufficient for product ${productId}.`);
          if (receipt?.lastReceiptAt !== null && receipt?.lastReceiptAt !== undefined && receipt.lastReceiptId !== null) {
            const adjustment = await transaction.inventoryHistory.findFirst({
              where: {
                inventoryId: inventory.id,
                type: { in: ["STOCKTAKE_ADJUSTMENT", "MANUAL_ADJUSTMENT"] },
                OR: [
                  { occurredAt: { gt: receipt.lastReceiptAt } },
                  { occurredAt: receipt.lastReceiptAt, id: { gt: receipt.lastReceiptId } },
                ],
              },
              select: { id: true },
            });
            if (adjustment !== null) refusalReasons.push(`A stocktake or manual adjustment followed the purchase receipt for product ${productId}.`);
          }
          inventoryEffects.push({
            productId,
            inventoryId: inventory.id,
            inventoryVersion: inventory.version,
            inventoryUnitId: group.unitId,
            quantityDelta: quantity.negated().toString(),
            quantityAfter: after.toString(),
            averageUnitCost: inventory.averageUnitCost?.toString() ?? null,
          });
        }

        const master = priceMasters.get(productId);
        if (master === undefined) {
          refusalReasons.push(`PriceMaster is missing for product ${productId}.`);
          priceSourceKinds.set(productId, "MISSING_PRICE_MASTER");
          priceEffects.push({ productId, priceMasterId: null, version: null, currentPriceHistoryId: null, currentUnitPrice: null, currency: null, source: "MISSING_PRICE_MASTER", requiresPriceResolution: false });
          continue;
        }
        const source = master.currentPriceHistoryId === null
          ? "LEGACY_UNKNOWN_CURRENT"
          : originalHistoryIds.has(master.currentPriceHistoryId)
            ? "ORIGINAL_PURCHASE_CURRENT"
            : "SUBSEQUENT_PRICE_HISTORY_CURRENT";
        priceSourceKinds.set(productId, source);
        priceEffects.push({
          productId,
          priceMasterId: master.id,
          version: master.version,
          currentPriceHistoryId: master.currentPriceHistoryId,
          currentUnitPrice: master.currentUnitPrice.toString(),
          currency: master.currency,
          source,
          requiresPriceResolution: source !== "SUBSEQUENT_PRICE_HISTORY_CURRENT",
        });
      }
    }

    const previewSeed = {
      purchase: {
        id: purchase.id,
        status: purchase.status,
        supplierId: purchase.supplierId,
        documentNumber: purchase.documentNumber,
        postedAt: purchase.postedAt?.toISOString() ?? null,
      },
      existingReversal: existingReversal === null ? null : { id: existingReversal.id, reversedAt: existingReversal.reversedAt.toISOString() },
      refusalReasons: [...new Set(refusalReasons)].sort(),
      items: items.map((item) => ({ id: item.id, productId: item.productId, unitId: item.unitId, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString() })),
      inventoryEffects,
      priceEffects,
    };
    const preview: PurchaseReversalPreview = {
      purchaseId: purchase.id,
      canReverse: refusalReasons.length === 0,
      refusalReasons: [...new Set(refusalReasons)].sort(),
      previewVersion: this.hash(previewSeed),
      existingReversal: existingReversal === null ? null : { id: existingReversal.id, reversedAt: existingReversal.reversedAt },
      inventoryEffects,
      priceEffects,
    };
    return { preview, purchase, items, priceMasters, inventories, priceSourceKinds };
  }

  private groupItems(items: readonly PurchaseItemRow[]): Map<string, { quantity: Prisma.Decimal; unitId: string; itemCount: number }> {
    const groups = new Map<string, { quantity: Prisma.Decimal; unitId: string; itemCount: number }>();
    for (const item of items) {
      const current = groups.get(item.productId);
      if (current === undefined) groups.set(item.productId, { quantity: new Prisma.Decimal(item.quantity), unitId: item.unitId, itemCount: 1 });
      else {
        if (current.unitId !== item.unitId) throw new PurchasePostedReversalConflictError(`Purchase product ${item.productId} has inconsistent inventory units.`);
        current.quantity = current.quantity.add(item.quantity);
        current.itemCount += 1;
      }
    }
    return groups;
  }

  private normalizeResolutions(values: readonly PriceResolutionInput[]): Map<string, PriceResolutionInput> {
    const result = new Map<string, PriceResolutionInput>();
    for (const value of values) {
      const productId = value.productId.trim();
      const currency = value.currency.trim();
      if (productId.length === 0 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.currentUnitPrice) || !/^[A-Z]{3}$/.test(currency)) {
        throw new PurchasePostedReversalValidationError("Price resolutions contain an invalid value.");
      }
      if (!Number.isSafeInteger(value.expectedPriceMasterVersion) || value.expectedPriceMasterVersion < 1) {
        throw new PurchasePostedReversalValidationError("Price resolution version is invalid.");
      }
      if (result.has(productId)) throw new PurchasePostedReversalValidationError("Price resolutions must contain each product at most once.");
      result.set(productId, { ...value, productId, currency });
    }
    return result;
  }

  private assertResolutions(inspection: ReversalInspection, resolutions: Map<string, PriceResolutionInput>): void {
    for (const price of inspection.preview.priceEffects) {
      const resolution = resolutions.get(price.productId);
      if (price.requiresPriceResolution) {
        if (resolution === undefined || resolution.expectedPriceMasterVersion !== price.version) {
          throw new PurchasePostedReversalConflictError(`An explicit current price resolution is required for product ${price.productId}.`);
        }
      } else if (resolution !== undefined) {
        throw new PurchasePostedReversalValidationError(`Product ${price.productId} must not supply a price resolution because a later price source remains current.`);
      }
    }
    for (const productId of resolutions.keys()) {
      if (!inspection.priceMasters.has(productId)) throw new PurchasePostedReversalValidationError(`Price resolution product ${productId} is not part of the purchase.`);
    }
  }

  private inventoryUnitFor(items: readonly PurchaseItemRow[], productId: string): string {
    const item = items.find((candidate) => candidate.productId === productId);
    if (item === undefined) throw new PurchasePostedReversalConflictError(`Missing purchase item for product ${productId}.`);
    return item.unitId;
  }

  private hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private isConcurrencyError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = String(error.code);
    const message = "message" in error ? String(error.message) : "";
    // Prisma can wrap a PostgreSQL serialization failure from $queryRaw in a
    // P2010 error, exposing SQLSTATE only in meta.code or the message. Limit
    // that adapter-specific normalization to serialization_failure (40001).
    if (code === "P2010") {
      const metaCode = "meta" in error && typeof error.meta === "object" && error.meta !== null && "code" in error.meta
        ? String(error.meta.code)
        : "";
      return metaCode === "40001" || /\b40001\b/.test(message);
    }
    return code === "P2002" || code === "P2034" || code === "40001" || code === "40P01";
  }
}
