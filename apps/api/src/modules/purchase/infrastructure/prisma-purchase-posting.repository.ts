import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import { InventoryValuationUnavailableError } from "../application/purchase-posting.errors";
import { calculateNextAverageUnitCost } from "./inventory-valuation";
import {
  type PurchaseForPosting,
  type PurchaseItemForPosting,
  type PurchasePostingRepository,
  type PurchasePostingStatus,
  type PurchasePostingTransaction,
} from "../application/purchase-posting.repository";

type LockedPurchaseRow = {
  id: string;
  supplierId: string;
  purchaseDate: Date;
  currency: string;
  status: PurchasePostingStatus;
};

@Injectable()
export class PrismaPurchasePostingRepository implements PurchasePostingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(
    operation: (transaction: PurchasePostingTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (client) =>
      operation(new PrismaPurchasePostingTransaction(client)),
    );
  }
}

class PrismaPurchasePostingTransaction implements PurchasePostingTransaction {
  constructor(private readonly prisma: TransactionClient) {}

  async lockPurchase(purchaseId: string): Promise<PurchaseForPosting | null> {
    // Keep the same row-lock order as the source-history triggers. Locking all
    // items first in a stable order prevents a cycle with a concurrent history
    // write that has already locked one PurchaseItem and is waiting on Purchase.
    await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "PurchaseItem"
      WHERE "purchaseId" = ${purchaseId}
      ORDER BY "id"
      FOR NO KEY UPDATE
    `);

    const rows = await this.prisma.$queryRaw<LockedPurchaseRow[]>(Prisma.sql`
      SELECT "id", "supplierId", "purchaseDate", "currency", "status"
      FROM "Purchase"
      WHERE "id" = ${purchaseId}
      FOR UPDATE
    `);
    const purchase = rows[0];

    if (purchase === undefined) {
      return null;
    }

    const items = await this.prisma.purchaseItem.findMany({
      where: { purchaseId },
      orderBy: { lineNumber: "asc" },
      select: {
        id: true,
        productId: true,
        unitId: true,
        lineNumber: true,
        quantity: true,
        unitPrice: true,
        product: { select: { inventoryUnitId: true } },
      },
    });

    return {
      ...purchase,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        unitId: item.unitId,
        inventoryUnitId: item.product.inventoryUnitId,
        lineNumber: item.lineNumber,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
      })),
    };
  }

  async writePriceEffect(
    purchase: PurchaseForPosting,
    item: PurchaseItemForPosting,
  ): Promise<void> {
    const priceMaster = await this.prisma.priceMaster.upsert({
      where: {
        productId_supplierId: {
          productId: item.productId,
          supplierId: purchase.supplierId,
        },
      },
      create: {
        productId: item.productId,
        supplierId: purchase.supplierId,
        currentUnitPrice: item.unitPrice,
        currency: purchase.currency,
        currentPriceEffectiveAt: purchase.purchaseDate,
      },
      update: {
        currentUnitPrice: item.unitPrice,
        currency: purchase.currency,
        currentPriceEffectiveAt: purchase.purchaseDate,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });

    await this.prisma.priceHistory.create({
      data: {
        priceMasterId: priceMaster.id,
        sourcePurchaseItemId: item.id,
        inventoryUnitId: item.inventoryUnitId,
        unitPrice: item.unitPrice,
        currency: purchase.currency,
        effectiveAt: purchase.purchaseDate,
      },
    });
  }

  async markPurchasePosted(purchaseId: string, postedAt: Date): Promise<void> {
    await this.prisma.purchase.update({
      where: { id: purchaseId },
      data: { status: "POSTED", postedAt, cancelledAt: null },
    });
  }

  async writeInventoryEffect(
    _purchase: PurchaseForPosting,
    item: PurchaseItemForPosting,
  ): Promise<void> {
    await this.prisma.inventory.upsert({
      where: { productId: item.productId },
      create: { productId: item.productId, quantity: "0" },
      update: {},
    });

    // The unique Product inventory row serializes valued receipts for the same
    // product. Lock it before reading its quantity/cost and updating both.
    const lockedInventories = await this.prisma.$queryRaw<
      { id: string; quantity: Prisma.Decimal; averageUnitCost: Prisma.Decimal | null }[]
    >(Prisma.sql`
      SELECT "id", "quantity", "averageUnitCost"
      FROM "Inventory"
      WHERE "productId" = ${item.productId}
      FOR UPDATE
    `);
    const lockedInventory = lockedInventories[0];

    if (lockedInventory === undefined) {
      throw new Error(`Inventory for product ${item.productId} was not found.`);
    }

    const receivedQuantity = new Prisma.Decimal(item.quantity);
    const receivedCost = new Prisma.Decimal(item.unitPrice);
    const previousQuantity = lockedInventory.quantity;
    if (!previousQuantity.isZero() && lockedInventory.averageUnitCost === null) {
      // A non-zero legacy/manual balance without a valuation cannot be safely
      // folded into a weighted average. Backfill or reconcile it explicitly.
      throw new InventoryValuationUnavailableError(item.productId);
    }
    const nextQuantity = previousQuantity.add(receivedQuantity);
    const nextAverageUnitCost = calculateNextAverageUnitCost(
      previousQuantity,
      lockedInventory.averageUnitCost,
      receivedQuantity,
      receivedCost,
    );

    const inventory = await this.prisma.inventory.update({
      where: { id: lockedInventory.id },
      data: { quantity: nextQuantity, averageUnitCost: nextAverageUnitCost },
      select: { id: true, quantity: true },
    });

    await this.prisma.inventoryHistory.create({
      data: {
        inventoryId: inventory.id,
        sourcePurchaseItemId: item.id,
        inventoryUnitId: item.inventoryUnitId,
        type: "RECEIPT",
        quantityDelta: item.quantity,
        quantityAfter: inventory.quantity,
      },
    });
  }

  async appendPostedLog(
    purchaseId: string,
    fromStatus: PurchasePostingStatus,
    occurredAt: Date,
  ): Promise<void> {
    await this.prisma.purchaseLog.create({
      data: {
        purchaseId,
        eventType: "STATUS_CHANGED",
        fromStatus,
        toStatus: "POSTED",
        occurredAt,
      },
    });
  }
}
