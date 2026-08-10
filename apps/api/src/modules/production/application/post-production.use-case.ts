import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { calculateNextAverageUnitCost } from "../../purchase/infrastructure/inventory-valuation";
import {
  InsufficientProductionInventoryError,
  InvalidProductionPostingError,
  ProductionNotFoundError,
  ProductionPostingConflictError,
} from "./production-posting.errors";
import {
  PRODUCTION_POSTING_REPOSITORY,
  type LockedInventory,
  type ProductionPostingRepository,
} from "./production-posting.repository";

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

@Injectable()
export class PostProductionUseCase {
  constructor(@Inject(PRODUCTION_POSTING_REPOSITORY) private readonly repository: ProductionPostingRepository) {}

  async execute(productionId: string, actualQuantityValue: string) {
    if (!DECIMAL.test(actualQuantityValue) || new Prisma.Decimal(actualQuantityValue).lte(0)) {
      throw new InvalidProductionPostingError("actualQuantity must be a positive decimal string.");
    }
    const actualQuantity = new Prisma.Decimal(actualQuantityValue);

    return this.repository.withTransaction(async (transaction) => {
      const production = await transaction.lockProduction(productionId);
      if (production === null) throw new ProductionNotFoundError(productionId);
      if (production.consumptions.length === 0) {
        throw new InvalidProductionPostingError("A Production must have at least one consumption.");
      }

      const productIds = [...new Set([...production.consumptions.map((c) => c.productId), production.outputProductIdSnapshot])].sort();
      const inventories = await transaction.lockInventories(productIds);
      const inventoryByProduct = new Map(inventories.map((inventory) => [inventory.productId, inventory]));
      if (inventoryByProduct.size !== productIds.length) {
        throw new InvalidProductionPostingError("Every input and output Product must have an Inventory row.");
      }
      const lockedStatus = await transaction.lockProductionStatus(production.id);
      if (lockedStatus === null) throw new ProductionNotFoundError(productionId);
      if (lockedStatus !== "CONFIRMED") {
        throw new ProductionPostingConflictError(`Production ${productionId} cannot be posted from ${lockedStatus}.`);
      }

      const scale = actualQuantity.div(new Prisma.Decimal(production.yieldQuantitySnapshot));
      let materialCost = new Prisma.Decimal(0);
      const consumptionEffects: Array<{ id: string; inventory: LockedInventory; quantity: Prisma.Decimal }> = [];

      for (const consumption of [...production.consumptions].sort((a, b) => a.id.localeCompare(b.id))) {
        const inventory = inventoryByProduct.get(consumption.productId)!;
        if (inventory.inventoryUnitId !== consumption.inventoryUnitId) {
          throw new InvalidProductionPostingError(`Consumption ${consumption.id} does not use its Product inventory unit.`);
        }
        if (inventory.averageUnitCost === null && !new Prisma.Decimal(inventory.quantity).isZero()) {
          throw new InvalidProductionPostingError(`Inventory valuation is unavailable for Product ${consumption.productId}.`);
        }
        const recipeQuantity = new Prisma.Decimal(consumption.recipeQuantitySnapshot).mul(scale);
        const inventoryQuantity = recipeQuantity.mul(new Prisma.Decimal(consumption.conversionFactorSnapshot)).toDecimalPlaces(9);
        const available = new Prisma.Decimal(inventory.quantity);
        if (available.lt(inventoryQuantity)) throw new InsufficientProductionInventoryError(`Insufficient inventory for Product ${consumption.productId}.`);
        const unitCost = new Prisma.Decimal(inventory.averageUnitCost ?? 0);
        const amount = inventoryQuantity.mul(unitCost).toDecimalPlaces(6);
        await transaction.updateConsumptionCost(consumption.id, recipeQuantity.toString(), inventoryQuantity.toString(), unitCost.toString(), amount.toString());
        materialCost = materialCost.add(amount);
        consumptionEffects.push({ id: consumption.id, inventory, quantity: inventoryQuantity });
      }

      const outputFactor = new Prisma.Decimal(await transaction.factorToInventory(production.outputProductIdSnapshot, production.outputUnitIdSnapshot));
      const finishedQuantity = actualQuantity.mul(outputFactor).toDecimalPlaces(9);
      if (finishedQuantity.lte(0)) throw new InvalidProductionPostingError("Finished inventory quantity must be positive.");
      const productionUnitCost = materialCost.div(finishedQuantity).toDecimalPlaces(6);
      const postedAt = new Date();

      // The existing database triggers require POSTED before source-linked histories.
      // This change remains unobservable until this interactive transaction commits.
      await transaction.markProductionPosted(production.id, actualQuantity.toString(), postedAt);

      for (const effect of consumptionEffects) {
        const previous = new Prisma.Decimal(effect.inventory.quantity);
        const next = previous.sub(effect.quantity);
        await transaction.updateInventory(effect.inventory.id, next.toString(), effect.inventory.averageUnitCost);
        await transaction.createConsumptionHistory(effect.id, effect.inventory, effect.quantity.negated().toString(), next.toString());
      }

      const outputInventory = inventoryByProduct.get(production.outputProductIdSnapshot)!;
      const outputNextQuantity = new Prisma.Decimal(outputInventory.quantity).add(finishedQuantity);
      const nextAverage = calculateNextAverageUnitCost(
        new Prisma.Decimal(outputInventory.quantity),
        outputInventory.averageUnitCost === null ? null : new Prisma.Decimal(outputInventory.averageUnitCost),
        finishedQuantity,
        productionUnitCost,
      );
      await transaction.updateInventory(outputInventory.id, outputNextQuantity.toString(), nextAverage.toString());
      await transaction.createOutputHistory(production.id, outputInventory, finishedQuantity.toString(), outputNextQuantity.toString());
      await transaction.appendPostedLog(production.id, postedAt);

      return { id: production.id, status: "POSTED" as const, postedAt, actualQuantity: actualQuantity.toString() };
    });
  }
}
