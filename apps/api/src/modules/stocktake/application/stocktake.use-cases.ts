import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { InvalidStocktakeError, StocktakeConflictError, StocktakeNotFoundError } from "./stocktake.errors";
import {
  STOCKTAKE_REPOSITORY,
  type StocktakeInput,
  type StocktakeRepository,
  type StocktakeView,
} from "./stocktake.repository";

@Injectable()
export class CreateStocktakeUseCase {
  constructor(@Inject(STOCKTAKE_REPOSITORY) private readonly repository: StocktakeRepository) {}

  execute(input: StocktakeInput): Promise<StocktakeView> {
    return this.repository.create(input);
  }
}

@Injectable()
export class GetStocktakeUseCase {
  constructor(@Inject(STOCKTAKE_REPOSITORY) private readonly repository: StocktakeRepository) {}

  async execute(id: string): Promise<StocktakeView> {
    const stocktake = await this.repository.get(id);
    if (stocktake === null) throw new StocktakeNotFoundError(id);
    return stocktake;
  }
}

@Injectable()
export class UpdateStocktakeUseCase {
  constructor(@Inject(STOCKTAKE_REPOSITORY) private readonly repository: StocktakeRepository) {}

  async execute(id: string, input: StocktakeInput): Promise<StocktakeView> {
    const result = await this.repository.updateDraft(id, input);
    if (result === "NOT_FOUND") throw new StocktakeNotFoundError(id);
    if (result === "CONFLICT") throw new StocktakeConflictError(`Stocktake ${id} is not editable.`);
    return result;
  }
}

@Injectable()
export class ConfirmStocktakeUseCase {
  constructor(@Inject(STOCKTAKE_REPOSITORY) private readonly repository: StocktakeRepository) {}

  async execute(id: string): Promise<StocktakeView> {
    const result = await this.repository.confirm(id);
    if (result === "NOT_FOUND") throw new StocktakeNotFoundError(id);
    if (result === "CONFLICT") throw new StocktakeConflictError(`Stocktake ${id} cannot be confirmed.`);
    return result;
  }
}

@Injectable()
export class PostStocktakeUseCase {
  constructor(@Inject(STOCKTAKE_REPOSITORY) private readonly repository: StocktakeRepository) {}

  async execute(id: string): Promise<{ id: string; status: "POSTED"; completedAt: Date }> {
    return this.repository.withTransaction(async (transaction) => {
      const lockedItems = await transaction.lockStocktakeItems(id);
      if (lockedItems.length === 0) {
        throw new InvalidStocktakeError("A Stocktake must contain at least one item.");
      }

      const stocktakeItems = [...lockedItems].sort((a, b) => a.id.localeCompare(b.id));
      for (const item of stocktakeItems) {
        if (item.countedQuantity === null) {
          throw new InvalidStocktakeError(`Stocktake item ${item.id} is missing countedQuantity.`);
        }
      }

      const productIds = [...new Set(stocktakeItems.map((item) => item.productId))].sort();
      const inventories = await transaction.lockInventories(productIds);
      const inventoryByProduct = new Map(inventories.map((inventory) => [inventory.productId, inventory]));
      if (inventoryByProduct.size !== productIds.length) {
        throw new InvalidStocktakeError("Every Stocktake item Product must have an Inventory row.");
      }

      const stocktake = await transaction.lockStocktake(id);
      if (stocktake === null) {
        throw new StocktakeNotFoundError(id);
      }
      if (stocktake.status !== "CONFIRMED") {
        throw new StocktakeConflictError(`Stocktake ${id} cannot be posted from ${stocktake.status}.`);
      }

      const postedAt = new Date();
      const adjustmentId = await transaction.createAdjustment(id, postedAt, stocktake.note);
      const deltaByProduct = new Map<string, Prisma.Decimal>();
      const nextQuantityByProduct = new Map<string, Prisma.Decimal>();

      const adjustmentItems = stocktakeItems.map((item) => {
        const inventory = inventoryByProduct.get(item.productId);
        if (inventory === undefined) {
          throw new InvalidStocktakeError(`Inventory for Product ${item.productId} was not found.`);
        }
        if (inventory.inventoryUnitId !== item.inventoryUnitId) {
          throw new InvalidStocktakeError(`Stocktake item ${item.id} does not match the inventory unit for Product ${item.productId}.`);
        }

        const countedQuantity = new Prisma.Decimal(item.countedQuantity ?? "0");
        const systemQuantity = new Prisma.Decimal(item.systemQuantitySnapshot ?? "0");
        const quantityDelta = countedQuantity.sub(systemQuantity);
        const accumulatedDelta = (deltaByProduct.get(item.productId) ?? new Prisma.Decimal(0)).add(quantityDelta);
        deltaByProduct.set(item.productId, accumulatedDelta);

        const currentQuantity = new Prisma.Decimal(inventory.quantity);
        const nextQuantity = currentQuantity.add(accumulatedDelta);
        if (nextQuantity.lt(0)) {
          throw new InvalidStocktakeError(`Inventory for Product ${item.productId} would become negative.`);
        }
        nextQuantityByProduct.set(item.productId, nextQuantity);

        return {
          stocktakeItemId: item.id,
          productId: item.productId,
          inventoryId: inventory.id,
          inventoryUnitId: item.inventoryUnitId,
          quantityDelta: quantityDelta.toString(),
          reason: "STOCKTAKE_DIFFERENCE" as const,
          note: item.note,
        };
      });

      const createdItems = await transaction.createAdjustmentItems(adjustmentId, adjustmentItems);
      const adjustmentItemIdByStocktakeItemId = new Map(
        createdItems.map((item) => [item.stocktakeItemId, item.adjustmentItemId]),
      );
      await transaction.updateInventories(
        [...nextQuantityByProduct.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([productId, quantity]) => ({
            inventoryId: inventoryByProduct.get(productId)!.id,
            quantity: quantity.toString(),
          })),
      );
      await transaction.markStocktakePosted(id, postedAt);
      await transaction.createInventoryHistories(
        adjustmentItems.map((item) => ({
          inventoryId: inventoryByProduct.get(item.productId)!.id,
          inventoryUnitId: item.inventoryUnitId,
          quantityDelta: item.quantityDelta,
          quantityAfter: nextQuantityByProduct.get(item.productId)!.toString(),
          sourceInventoryAdjustmentItemId: adjustmentItemIdByStocktakeItemId.get(item.stocktakeItemId)!,
        })),
      );

      return { id, status: "POSTED" as const, completedAt: postedAt };
    });
  }
}
