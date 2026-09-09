import { Injectable } from "@nestjs/common";
import { Prisma, type InventoryTransactionType } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  type CurrentInventoryPage,
  type CurrentInventoryView,
  type InventoryHistoryPage,
  type InventoryHistoryView,
  type InventoryReadRepository,
  type InventorySupplyContextPage,
  type InventorySupplyContextView,
  type ListCurrentInventoryQuery,
  type ListInventoryHistoryQuery,
} from "../application/inventory-read.repository";

type InventoryWithProduct = Prisma.InventoryGetPayload<{
  include: { product: { include: { inventoryUnit: true } } };
}>;

type HistoryWithUnit = Prisma.InventoryHistoryGetPayload<{
  include: { inventoryUnit: true };
}>;

@Injectable()
export class PrismaInventoryReadRepository implements InventoryReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCurrentInventory(query: ListCurrentInventoryQuery): Promise<CurrentInventoryPage> {
    const productWhere: Prisma.ProductWhereInput = {};
    if (query.productCode !== undefined) productWhere.code = query.productCode;
    if (query.cursor !== undefined) {
      productWhere.AND = [
        {
          OR: [
            { code: { gt: query.cursor.productCode } },
            { code: query.cursor.productCode, id: { gt: query.cursor.productId } },
          ],
        },
      ];
    }

    const rows = await this.prisma.inventory.findMany({
      where: { product: productWhere },
      include: { product: { include: { inventoryUnit: true } } },
      orderBy: [{ product: { code: "asc" } }, { productId: "asc" }],
      take: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.mapCurrentInventory(row)),
      nextCursor: rows.length > query.limit && last !== undefined
        ? { productCode: last.product.code, productId: last.productId }
        : null,
    };
  }

  async listSupplyContext(query: ListCurrentInventoryQuery): Promise<InventorySupplyContextPage> {
    return this.prisma.$transaction(async (tx) => {
      const productWhere: Prisma.ProductWhereInput = {};
      if (query.productCode !== undefined) productWhere.code = query.productCode;
      if (query.cursor !== undefined) {
        productWhere.AND = [
          {
            OR: [
              { code: { gt: query.cursor.productCode } },
              { code: query.cursor.productCode, id: { gt: query.cursor.productId } },
            ],
          },
        ];
      }

      // A repeatable-read transaction ensures the inventory rows and the two
      // independent unposted-purchase facts share one database snapshot. The
      // values are still never combined into a projected inventory quantity.
      const rows = await tx.inventory.findMany({
        where: { product: productWhere },
        include: { product: { include: { inventoryUnit: true } } },
        orderBy: [{ product: { code: "asc" } }, { productId: "asc" }],
        take: query.limit + 1,
      });
      const pageRows = rows.slice(0, query.limit);
      const productIds = pageRows.map((row) => row.productId);
      const [draftRows, confirmedRows] = await Promise.all([
        tx.purchaseItem.groupBy({
          by: ["productId"],
          where: {
            productId: { in: productIds },
            purchase: { is: { status: "DRAFT" } },
          },
          _sum: { quantity: true },
        }),
        tx.purchaseItem.groupBy({
          by: ["productId"],
          where: {
            productId: { in: productIds },
            purchase: { is: { status: "CONFIRMED" } },
          },
          _sum: { quantity: true },
        }),
      ]);
      const draftByProductId = new Map(draftRows.map((row) => [row.productId, row._sum.quantity?.toString() ?? "0"]));
      const confirmedByProductId = new Map(confirmedRows.map((row) => [row.productId, row._sum.quantity?.toString() ?? "0"]));
      const last = pageRows.at(-1);

      return {
        items: pageRows.map((row) => this.mapSupplyContext(
          row,
          draftByProductId.get(row.productId) ?? "0",
          confirmedByProductId.get(row.productId) ?? "0",
        )),
        nextCursor: rows.length > query.limit && last !== undefined
          ? { productCode: last.product.code, productId: last.productId }
          : null,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async listInventoryHistory(query: ListInventoryHistoryQuery): Promise<InventoryHistoryPage | null> {
    const inventory = await this.prisma.inventory.findUnique({
      where: { productId: query.productId },
      include: { product: { include: { inventoryUnit: true } } },
    });
    if (inventory === null) return null;

    const occurredAt: Prisma.DateTimeFilter = {};
    if (query.from !== undefined) occurredAt.gte = query.from;
    if (query.to !== undefined) occurredAt.lte = query.to;
    const historyWhere: Prisma.InventoryHistoryWhereInput = {
      inventoryId: inventory.id,
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(Object.keys(occurredAt).length === 0 ? {} : { occurredAt }),
    };
    if (query.cursor !== undefined) {
      historyWhere.AND = [
        {
          OR: [
            { occurredAt: { lt: query.cursor.occurredAt } },
            { occurredAt: query.cursor.occurredAt, id: { lt: query.cursor.id } },
          ],
        },
      ];
    }

    const rows = await this.prisma.inventoryHistory.findMany({
      where: historyWhere,
      include: { inventoryUnit: true },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      currentInventory: this.mapCurrentInventory(inventory),
      items: pageRows.map((row) => this.mapHistory(row)),
      nextCursor: rows.length > query.limit && last !== undefined
        ? { occurredAt: last.occurredAt, id: last.id }
        : null,
    };
  }

  private mapCurrentInventory(row: InventoryWithProduct): CurrentInventoryView {
    return {
      product: {
        id: row.product.id,
        code: row.product.code,
        name: row.product.name,
        status: row.product.status,
        isDeleted: row.product.deletedAt !== null,
      },
      quantity: row.quantity.toString(),
      inventoryUnit: {
        code: row.product.inventoryUnit.code,
        name: row.product.inventoryUnit.name,
        symbol: row.product.inventoryUnit.symbol,
      },
      updatedAt: row.updatedAt,
    };
  }

  private mapSupplyContext(
    row: InventoryWithProduct,
    draftPurchaseQuantity: string,
    confirmedPurchaseQuantity: string,
  ): InventorySupplyContextView {
    return {
      product: {
        id: row.product.id,
        code: row.product.code,
        name: row.product.name,
      },
      inventoryUnit: {
        code: row.product.inventoryUnit.code,
        name: row.product.inventoryUnit.name,
        symbol: row.product.inventoryUnit.symbol,
      },
      currentQuantity: row.quantity.toString(),
      draftPurchaseQuantity,
      confirmedPurchaseQuantity,
    };
  }

  private mapHistory(row: HistoryWithUnit): InventoryHistoryView {
    return {
      id: row.id,
      type: row.type as InventoryTransactionType,
      quantityDelta: row.quantityDelta.toString(),
      quantityAfter: row.quantityAfter.toString(),
      occurredAt: row.occurredAt,
      inventoryUnit: {
        code: row.inventoryUnit.code,
        name: row.inventoryUnit.name,
        symbol: row.inventoryUnit.symbol,
      },
    };
  }
}
