import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import { InvalidStocktakeError } from "../application/stocktake.errors";
import {
  type StocktakeInput,
  type StocktakePostingTransaction,
  type StocktakeRepository,
  type StocktakeStatus,
  type StocktakeView,
} from "../application/stocktake.repository";

type StocktakeRow = {
  id: string;
  status: StocktakeStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaStocktakeRepository implements StocktakeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: StocktakeInput): Promise<StocktakeView> {
    return this.prisma.$transaction(async (client) => {
      const normalizedItems = await this.prepareItems(client, input.items);
      const stocktake = await client.stocktake.create({
        data: { note: input.note ?? null },
        select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
      });

      await client.stocktakeItem.createMany({
        data: normalizedItems.map((item) => ({
          stocktakeId: stocktake.id,
          productId: item.productId,
          inventoryUnitId: item.inventoryUnitId,
          systemQuantitySnapshot: item.systemQuantitySnapshot,
          countedQuantity: item.countedQuantity,
          differenceQuantity: item.differenceQuantity,
          note: item.note,
        })),
      });
      const created = await client.stocktake.findUnique({
        where: { id: stocktake.id },
        select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
      });
      if (created === null) {
        throw new InvalidStocktakeError(`Stocktake ${stocktake.id} could not be reloaded after create.`);
      }
      return this.getOrThrow(client, stocktake.id, created);
    });
  }

  async get(id: string): Promise<StocktakeView | null> {
    return this.loadStocktake(this.prisma, id);
  }

  async updateDraft(id: string, input: StocktakeInput): Promise<StocktakeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const existingItems = await this.lockStocktakeItemsForDraftUpdate(client, id);
      const current = await this.lockStocktakeForDraftUpdate(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT") return "CONFLICT";

      const normalizedItems = await this.prepareItems(client, input.items);
      const incomingProductIds = new Set(normalizedItems.map((item) => item.productId));
      const removedProductIds = existingItems
        .map((item) => item.productId)
        .filter((productId) => !incomingProductIds.has(productId));

      for (const productId of removedProductIds) {
        await client.stocktakeItem.delete({
          where: { stocktakeId_productId: { stocktakeId: id, productId } },
        });
      }
      await client.stocktake.update({
        where: { id },
        data: { note: input.note ?? null },
      });

      const existingProductIds = new Set(existingItems.map((item) => item.productId));
      for (const item of normalizedItems) {
        const data = {
          inventoryUnitId: item.inventoryUnitId,
          systemQuantitySnapshot: item.systemQuantitySnapshot,
          countedQuantity: item.countedQuantity,
          differenceQuantity: item.differenceQuantity,
          note: item.note,
        };
        if (existingProductIds.has(item.productId)) {
          await client.stocktakeItem.update({
            where: { stocktakeId_productId: { stocktakeId: id, productId: item.productId } },
            data,
          });
          continue;
        }
        await client.stocktakeItem.create({
          data: { stocktakeId: id, productId: item.productId, ...data },
        });
      }
      const updated = await client.stocktake.findUnique({
        where: { id },
        select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
      });
      if (updated === null) {
        throw new InvalidStocktakeError(`Stocktake ${id} could not be reloaded after update.`);
      }
      return this.getOrThrow(client, id, updated);
    });
  }

  private lockStocktakeItemsForDraftUpdate(
    client: TransactionClient,
    stocktakeId: string,
  ): Promise<Array<{ productId: string }>> {
    return client.$queryRaw<Array<{ productId: string }>>(Prisma.sql`
      SELECT "productId"
      FROM "StocktakeItem"
      WHERE "stocktakeId" = ${stocktakeId}
      ORDER BY "id"
      FOR NO KEY UPDATE
    `);
  }

  private async lockStocktakeForDraftUpdate(
    client: TransactionClient,
    id: string,
  ): Promise<StocktakeRow | null> {
    const rows = await client.$queryRaw<StocktakeRow[]>(Prisma.sql`
      SELECT "id", "status", "startedAt", "completedAt", "note", "createdAt", "updatedAt"
      FROM "Stocktake"
      WHERE "id" = ${id}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  async confirm(id: string): Promise<StocktakeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const current = await client.stocktake.findUnique({
        where: { id },
        select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
      });
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT") return "CONFLICT";
      const items = await client.stocktakeItem.findMany({
        where: { stocktakeId: id },
        orderBy: { id: "asc" },
        select: { id: true, countedQuantity: true, systemQuantitySnapshot: true, productId: true, inventoryUnitId: true, differenceQuantity: true, note: true },
      });
      if (items.length === 0) {
        throw new InvalidStocktakeError("A Stocktake must contain at least one item.");
      }
      const now = new Date();
      await client.stocktake.update({
        where: { id },
        data: { status: "CONFIRMED", startedAt: now },
      });
      const updated = await client.stocktake.findUnique({
        where: { id },
        select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
      });
      if (updated === null) {
        throw new InvalidStocktakeError(`Stocktake ${id} could not be reloaded after confirmation.`);
      }
      return this.getOrThrow(client, id, updated);
    });
  }

  async withTransaction<T>(operation: (transaction: StocktakePostingTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => operation(new PrismaStocktakePostingTransaction(client)));
  }

  private async loadStocktake(client: PrismaService | TransactionClient, id: string): Promise<StocktakeView | null> {
    const stocktake = await client.stocktake.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true, completedAt: true, note: true, createdAt: true, updatedAt: true },
    });
    if (stocktake === null) return null;
    return this.getOrThrow(client, id, stocktake);
  }

  private async getOrThrow(
    client: PrismaService | TransactionClient,
    id: string,
    stocktakeRow: StocktakeRow,
  ): Promise<StocktakeView> {
    const items = await client.stocktakeItem.findMany({
      where: { stocktakeId: id },
      orderBy: { id: "asc" },
      select: {
        id: true,
        productId: true,
        inventoryUnitId: true,
        systemQuantitySnapshot: true,
        countedQuantity: true,
        differenceQuantity: true,
        note: true,
      },
    });
    return {
      ...stocktakeRow,
      items: items.map((item) => ({
        ...item,
        systemQuantitySnapshot: item.systemQuantitySnapshot?.toString() ?? null,
        countedQuantity: item.countedQuantity?.toString() ?? null,
        differenceQuantity: item.differenceQuantity?.toString() ?? null,
        note: item.note,
      })),
    };
  }

  private async prepareItems(
    client: PrismaService | TransactionClient,
    inputItems: StocktakeInput["items"],
  ): Promise<Array<{
    productId: string;
    inventoryUnitId: string;
    systemQuantitySnapshot: Prisma.Decimal;
    countedQuantity: Prisma.Decimal | null;
    differenceQuantity: Prisma.Decimal | null;
    note: string | null;
  }>> {
    const productIds = [...new Set(inputItems.map((item) => item.productId))];
    if (productIds.length !== inputItems.length) {
      throw new InvalidStocktakeError("Each Stocktake item Product must be unique.");
    }

    const products = await client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, inventoryUnitId: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    if (productById.size !== productIds.length) {
      throw new InvalidStocktakeError("Each Stocktake item Product must exist.");
    }
    const inventoryByProduct = new Map(
      (await client.inventory.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, quantity: true },
      })).map((inventory) => [inventory.productId, inventory]),
    );

    return inputItems.map((item) => {
      const product = productById.get(item.productId);
      if (product === undefined) {
        throw new InvalidStocktakeError(`Product ${item.productId} was not found.`);
      }
      const systemQuantitySnapshot = inventoryByProduct.get(item.productId)?.quantity ?? new Prisma.Decimal(0);
      const countedQuantity = item.countedQuantity === undefined || item.countedQuantity === null
        ? null
        : new Prisma.Decimal(item.countedQuantity);
      if (countedQuantity !== null && countedQuantity.lt(0)) {
        throw new InvalidStocktakeError(`Stocktake item for Product ${item.productId} must not be negative.`);
      }
      return {
        productId: item.productId,
        inventoryUnitId: product.inventoryUnitId,
        systemQuantitySnapshot,
        countedQuantity,
        differenceQuantity: countedQuantity === null ? null : countedQuantity.sub(systemQuantitySnapshot),
        note: item.note ?? null,
      };
    });
  }
}

class PrismaStocktakePostingTransaction implements StocktakePostingTransaction {
  constructor(private readonly prisma: TransactionClient) {}

  async lockStocktakeItems(stocktakeId: string): Promise<Array<{
    id: string;
    productId: string;
    inventoryUnitId: string;
    systemQuantitySnapshot: string | null;
    countedQuantity: string | null;
    differenceQuantity: string | null;
    note: string | null;
  }>> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      productId: string;
      inventoryUnitId: string;
      systemQuantitySnapshot: Prisma.Decimal | null;
      countedQuantity: Prisma.Decimal | null;
      differenceQuantity: Prisma.Decimal | null;
      note: string | null;
    }>>(Prisma.sql`
      SELECT "id", "productId", "inventoryUnitId", "systemQuantitySnapshot", "countedQuantity", "differenceQuantity", "note"
      FROM "StocktakeItem"
      WHERE "stocktakeId" = ${stocktakeId}
      ORDER BY "id"
      FOR NO KEY UPDATE
    `);
    return rows.map((row) => ({
      ...row,
      systemQuantitySnapshot: row.systemQuantitySnapshot?.toString() ?? null,
      countedQuantity: row.countedQuantity?.toString() ?? null,
      differenceQuantity: row.differenceQuantity?.toString() ?? null,
      note: row.note,
    }));
  }

  async lockInventories(productIds: string[]): Promise<Array<{ id: string; productId: string; quantity: string; averageUnitCost: string | null; inventoryUnitId: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      productId: string;
      quantity: Prisma.Decimal;
      averageUnitCost: Prisma.Decimal | null;
      inventoryUnitId: string;
    }>>(Prisma.sql`
      SELECT inventory."id", inventory."productId", inventory."quantity", inventory."averageUnitCost", product."inventoryUnitId"
      FROM "Inventory" AS inventory
      INNER JOIN "Product" AS product ON product."id" = inventory."productId"
      WHERE inventory."productId" IN (${Prisma.join(productIds)})
      ORDER BY inventory."productId"
      FOR UPDATE OF inventory
    `);
    return rows.map((row) => ({
      ...row,
      quantity: row.quantity.toString(),
      averageUnitCost: row.averageUnitCost?.toString() ?? null,
    }));
  }

  async lockStocktake(stocktakeId: string): Promise<StocktakeView | null> {
    const row = await this.prisma.$queryRaw<StocktakeRow[]>(Prisma.sql`
      SELECT "id", "status", "startedAt", "completedAt", "note", "createdAt", "updatedAt"
      FROM "Stocktake"
      WHERE "id" = ${stocktakeId}
      FOR UPDATE
    `);
    const stocktake = row[0];
    if (stocktake === undefined) return null;
    const items = await this.prisma.stocktakeItem.findMany({
      where: { stocktakeId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        productId: true,
        inventoryUnitId: true,
        systemQuantitySnapshot: true,
        countedQuantity: true,
        differenceQuantity: true,
        note: true,
      },
    });
    return {
      ...stocktake,
      items: items.map((item) => ({
        ...item,
        systemQuantitySnapshot: item.systemQuantitySnapshot?.toString() ?? null,
        countedQuantity: item.countedQuantity?.toString() ?? null,
        differenceQuantity: item.differenceQuantity?.toString() ?? null,
        note: item.note,
      })),
    };
  }

  async createAdjustment(stocktakeId: string, postedAt: Date, note: string | null): Promise<string> {
    const row = await this.prisma.inventoryAdjustment.create({
      data: {
        stocktakeId,
        status: "POSTED",
        postedAt,
        note,
      },
      select: { id: true },
    });
    return row.id;
  }

  async createAdjustmentItems(
    adjustmentId: string,
    items: Array<{
      stocktakeItemId: string;
      productId: string;
      inventoryId: string;
      inventoryUnitId: string;
      quantityDelta: string;
      reason: "STOCKTAKE_DIFFERENCE" | "SHRINKAGE" | "DAMAGE" | "ROUNDING" | "OTHER";
      note: string | null;
    }>,
  ): Promise<Array<{ stocktakeItemId: string; adjustmentItemId: string }>> {
    const created: Array<{ stocktakeItemId: string; adjustmentItemId: string }> = [];
    for (const item of items) {
      const adjustmentItem = await this.prisma.inventoryAdjustmentItem.create({
        data: {
          adjustmentId,
          stocktakeItemId: item.stocktakeItemId,
          productId: item.productId,
          inventoryId: item.inventoryId,
          inventoryUnitId: item.inventoryUnitId,
          quantityDelta: item.quantityDelta,
          reason: item.reason,
          note: item.note,
        },
        select: { id: true, stocktakeItemId: true },
      });
      created.push({ stocktakeItemId: adjustmentItem.stocktakeItemId, adjustmentItemId: adjustmentItem.id });
    }
    return created;
  }

  async updateInventories(updates: Array<{ inventoryId: string; quantity: string }>): Promise<void> {
    for (const update of updates) {
      await this.prisma.inventory.update({
        where: { id: update.inventoryId },
        data: { quantity: update.quantity },
      });
    }
  }

  async markStocktakePosted(stocktakeId: string, completedAt: Date): Promise<void> {
    await this.prisma.stocktake.update({
      where: { id: stocktakeId },
      data: { status: "POSTED", completedAt },
    });
  }

  async createInventoryHistories(entries: Array<{
    inventoryId: string;
    inventoryUnitId: string;
    quantityDelta: string;
    quantityAfter: string;
    sourceInventoryAdjustmentItemId: string;
  }>): Promise<void> {
    await this.prisma.inventoryHistory.createMany({
      data: entries.map((entry) => ({
        inventoryId: entry.inventoryId,
        inventoryUnitId: entry.inventoryUnitId,
        type: "STOCKTAKE_ADJUSTMENT",
        quantityDelta: entry.quantityDelta,
        quantityAfter: entry.quantityAfter,
        sourceInventoryAdjustmentItemId: entry.sourceInventoryAdjustmentItemId,
      })),
    });
  }
}
