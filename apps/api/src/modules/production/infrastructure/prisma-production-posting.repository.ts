import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  LockedInventory,
  ProductionForPosting,
  ProductionPostingRepository,
  ProductionPostingTransaction,
} from "../application/production-posting.repository";

@Injectable()
export class PrismaProductionPostingRepository implements ProductionPostingRepository {
  constructor(private readonly prisma: PrismaService) {}
  async withTransaction<T>(operation: (transaction: ProductionPostingTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (client) => operation(new PrismaProductionPostingTransaction(client)));
  }
}

class PrismaProductionPostingTransaction implements ProductionPostingTransaction {
  constructor(private readonly prisma: TransactionClient) {}

  async lockProduction(id: string): Promise<ProductionForPosting | null> {
    // The shared lock convention is Consumption (stable ID order), Inventory
    // (stable Product ID order), then Production. This matches the source
    // history triggers' Consumption -> Production sequence.
    await this.prisma.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ProductionConsumption"
      WHERE "productionId" = ${id} ORDER BY "id" FOR NO KEY UPDATE
    `);
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; status: "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";
      outputProductIdSnapshot: string; outputUnitIdSnapshot: string; outputConversionFactorSnapshot: Prisma.Decimal; yieldQuantitySnapshot: Prisma.Decimal;
    }>>(Prisma.sql`
      SELECT "id", "status", "outputProductIdSnapshot", "outputUnitIdSnapshot", "outputConversionFactorSnapshot", "yieldQuantitySnapshot"
      FROM "Production" WHERE "id" = ${id}
    `);
    const production = rows[0];
    if (production === undefined) return null;
    const consumptions = await this.prisma.productionConsumption.findMany({
      where: { productionId: id }, orderBy: { id: "asc" },
      select: { id: true, productId: true, recipeQuantitySnapshot: true, recipeUnitId: true, inventoryUnitId: true, conversionFactorSnapshot: true },
    });
    return { ...production, yieldQuantitySnapshot: production.yieldQuantitySnapshot.toString(), outputConversionFactorSnapshot: production.outputConversionFactorSnapshot.toString(), consumptions: consumptions.map((item) => ({
      ...item,
      recipeQuantitySnapshot: item.recipeQuantitySnapshot.toString(),
      conversionFactorSnapshot: item.conversionFactorSnapshot.toString(),
    })) };
  }

  async lockInventories(productIds: string[]): Promise<LockedInventory[]> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; productId: string; quantity: Prisma.Decimal; averageUnitCost: Prisma.Decimal | null; inventoryUnitId: string;
    }>>(Prisma.sql`
      SELECT inventory."id", inventory."productId", inventory."quantity", inventory."averageUnitCost", product."inventoryUnitId"
      FROM "Inventory" AS inventory
      INNER JOIN "Product" AS product ON product."id" = inventory."productId"
      WHERE inventory."productId" IN (${Prisma.join(productIds)})
      ORDER BY inventory."productId" FOR UPDATE OF inventory
    `);
    return rows.map((row) => ({ ...row, quantity: row.quantity.toString(), averageUnitCost: row.averageUnitCost?.toString() ?? null }));
  }

  async lockProductionStatus(id: string): Promise<"DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED" | null> {
    const rows = await this.prisma.$queryRaw<Array<{ status: "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED" }>>(Prisma.sql`
      SELECT "status" FROM "Production" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0]?.status ?? null;
  }

  async updateConsumptionCost(id: string, recipeQuantity: string, inventoryQuantity: string, unitCost: string, amount: string): Promise<void> {
    await this.prisma.productionConsumption.update({ where: { id }, data: {
      recipeQuantitySnapshot: recipeQuantity, inventoryQuantity, unitCostSnapshot: unitCost, amountSnapshot: amount,
    } });
  }

  async markProductionPosted(id: string, actualQuantity: string, postedAt: Date): Promise<void> {
    await this.prisma.production.update({ where: { id }, data: { status: "POSTED", actualQuantity, postedAt, cancelledAt: null } });
  }

  async updateInventory(id: string, quantity: string, averageUnitCost: string | null): Promise<void> {
    await this.prisma.inventory.update({ where: { id }, data: { quantity, averageUnitCost } });
  }

  async createConsumptionHistory(consumptionId: string, inventory: LockedInventory, quantity: string, quantityAfter: string): Promise<void> {
    await this.prisma.inventoryHistory.create({ data: {
      inventoryId: inventory.id, inventoryUnitId: inventory.inventoryUnitId, type: "CONSUMPTION",
      quantityDelta: quantity, quantityAfter, sourceProductionConsumptionId: consumptionId,
    } });
  }

  async createOutputHistory(productionId: string, inventory: LockedInventory, quantity: string, quantityAfter: string): Promise<void> {
    await this.prisma.inventoryHistory.create({ data: {
      inventoryId: inventory.id, inventoryUnitId: inventory.inventoryUnitId, type: "PRODUCTION_RECEIPT",
      quantityDelta: quantity, quantityAfter, sourceProductionId: productionId,
    } });
  }

  async appendPostedLog(productionId: string, occurredAt: Date): Promise<void> {
    void occurredAt;
    await this.prisma.productionLog.create({ data: { productionId, eventType: "STATUS_CHANGED", fromStatus: "CONFIRMED", toStatus: "POSTED" } });
  }
}
