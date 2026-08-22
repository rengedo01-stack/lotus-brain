import { Injectable } from "@nestjs/common";
import { Prisma, ProductionStatus } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  ProductionLifecycleValidationError,
} from "../application/production-lifecycle.errors";
import {
  type ProductionConsumptionView,
  type ProductionCreateInput,
  type ProductionDraftPatchInput,
  type ProductionLifecycleRepository,
  type ProductionLifecycleStatus,
  type ProductionView,
} from "../application/production-lifecycle.repository";

type ProductionClient = PrismaService | TransactionClient;

type ProductionRow = {
  id: string;
  recipeId: string;
  productionDate: Date;
  plannedQuantity: Prisma.Decimal;
  actualQuantity: Prisma.Decimal | null;
  status: ProductionStatus;
  note: string | null;
  postedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  outputProductIdSnapshot: string;
  yieldQuantitySnapshot: Prisma.Decimal;
  outputUnitIdSnapshot: string;
  outputConversionFactorSnapshot: Prisma.Decimal;
  recipe: { id: string; rootRecipeId: string; revision: number };
  consumptions: Array<{
    id: string;
    lineNumber: number;
    productId: string;
    recipeQuantitySnapshot: Prisma.Decimal;
    recipeUnitId: string;
    inventoryQuantity: Prisma.Decimal;
    inventoryUnitId: string;
    conversionFactorSnapshot: Prisma.Decimal;
    unitCostSnapshot: Prisma.Decimal;
    amountSnapshot: Prisma.Decimal;
    currency: string;
  }>;
};

type ActiveRecipe = {
  id: string;
  rootRecipeId: string;
  revision: number;
  outputProductId: string;
  yieldQuantity: Prisma.Decimal;
  yieldUnitId: string;
};

type ActiveProduct = {
  id: string;
  baseUnitId: string;
  inventoryUnitId: string;
};

const DECIMAL_24_9 = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/;

@Injectable()
export class PrismaProductionLifecycleRepository implements ProductionLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ProductionCreateInput): Promise<ProductionView> {
    const productionDate = this.productionDate(input.productionDate);
    const plannedQuantity = this.positiveDecimal(input.plannedQuantity, "plannedQuantity");
    if (typeof input.recipeId !== "string" || input.recipeId.trim().length === 0) {
      throw new ProductionLifecycleValidationError("recipeId is required.");
    }

    return this.prisma.$transaction(async (client) => {
      const recipe = await this.lockActiveRecipe(client, input.recipeId);
      if (recipe === null) {
        throw new ProductionLifecycleValidationError("Production creation requires an ACTIVE Recipe.");
      }
      const consumptions = await this.snapshotConsumptions(client, recipe);
      if (consumptions.length === 0) {
        throw new ProductionLifecycleValidationError("An ACTIVE Recipe must contain at least one ingredient.");
      }

      const production = await client.production.create({
        data: {
          recipeId: recipe.id,
          productionDate,
          plannedQuantity,
          outputProductIdSnapshot: recipe.outputProductId,
          yieldQuantitySnapshot: recipe.yieldQuantity,
          outputUnitIdSnapshot: recipe.yieldUnitId,
          status: "DRAFT",
          note: input.note ?? null,
        },
        select: { id: true },
      });
      await client.productionConsumption.createMany({
        data: consumptions.map((consumption) => ({
          productionId: production.id,
          productId: consumption.productId,
          lineNumber: consumption.lineNumber,
          recipeQuantitySnapshot: consumption.recipeQuantitySnapshot,
          recipeUnitId: consumption.recipeUnitId,
          inventoryQuantity: consumption.inventoryQuantity,
          inventoryUnitId: consumption.inventoryUnitId,
          conversionFactorSnapshot: consumption.conversionFactorSnapshot,
          unitCostSnapshot: "0",
          amountSnapshot: "0",
        })),
      });
      return this.getOrThrow(client, production.id);
    });
  }

  async get(id: string): Promise<ProductionView | null> {
    const production = await this.load(this.prisma, id);
    return production === null ? null : this.view(production);
  }

  async updateDraft(id: string, input: ProductionDraftPatchInput): Promise<ProductionView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      await this.lockConsumptionIds(client, id);
      const current = await this.lockProduction(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT") return "CONFLICT";

      const data: { productionDate?: Date; plannedQuantity?: Prisma.Decimal; note?: string | null } = {};
      if (input.productionDate !== undefined) data.productionDate = this.productionDate(input.productionDate);
      if (input.plannedQuantity !== undefined) data.plannedQuantity = this.positiveDecimal(input.plannedQuantity, "plannedQuantity");
      if (input.note !== undefined) data.note = input.note;
      await client.production.update({ where: { id }, data });
      return this.getOrThrow(client, id);
    });
  }

  async confirm(id: string): Promise<ProductionView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const consumptionIds = await this.lockConsumptionIds(client, id);
      const current = await this.lockProduction(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT") return "CONFLICT";
      if (consumptionIds.length === 0) {
        throw new ProductionLifecycleValidationError("A Production must contain at least one consumption.");
      }

      await client.production.update({ where: { id }, data: { status: "CONFIRMED" } });
      await client.productionLog.create({
        data: { productionId: id, eventType: "STATUS_CHANGED", fromStatus: "DRAFT", toStatus: "CONFIRMED" },
      });
      return this.getOrThrow(client, id);
    });
  }

  private async snapshotConsumptions(
    client: TransactionClient,
    recipe: ActiveRecipe,
  ): Promise<Array<{
    productId: string;
    lineNumber: number;
    recipeQuantitySnapshot: Prisma.Decimal;
    recipeUnitId: string;
    inventoryQuantity: Prisma.Decimal;
    inventoryUnitId: string;
    conversionFactorSnapshot: Prisma.Decimal;
  }>> {
    const items = await client.recipeItem.findMany({
      where: { recipeId: recipe.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { productId: true, unitId: true, quantity: true, sortOrder: true },
    });
    const productIds = [...new Set([recipe.outputProductId, ...items.map((item) => item.productId)])];
    const products = await this.lockActiveProducts(client, productIds);
    const productById = new Map(products.map((product) => [product.id, product]));
    if (productById.size !== productIds.length) {
      throw new ProductionLifecycleValidationError("Production Recipe Products must be active.");
    }

    const requiredUnitIds = new Set<string>();
    for (const product of products) {
      requiredUnitIds.add(product.baseUnitId);
      requiredUnitIds.add(product.inventoryUnitId);
    }
    requiredUnitIds.add(recipe.yieldUnitId);
    for (const item of items) requiredUnitIds.add(item.unitId);
    const activeUnits = await this.lockActiveUnits(client, [...requiredUnitIds]);
    if (activeUnits.length !== requiredUnitIds.size) {
      throw new ProductionLifecycleValidationError("Production Recipe Units must be active.");
    }

    await this.lockActiveConversions(client, productIds);

    // Validate the output conversion during draft creation. The INSERT trigger
    // independently captures the same factor, so direct database clients cannot
    // bypass this contract.
    await this.factorToInventory(client, recipe.outputProductId, recipe.yieldUnitId);

    const snapshots = [];
    for (const item of items) {
      const product = productById.get(item.productId);
      if (product === undefined) {
        throw new ProductionLifecycleValidationError("Production Recipe Product was not found.");
      }
      const conversionFactorSnapshot = await this.factorToInventory(client, product.id, item.unitId);
      const inventoryQuantity = new Prisma.Decimal(item.quantity)
        .mul(conversionFactorSnapshot)
        .toDecimalPlaces(9);
      if (inventoryQuantity.lte(0)) {
        throw new ProductionLifecycleValidationError("Production ingredient quantity is below inventory precision.");
      }
      snapshots.push({
        productId: product.id,
        lineNumber: item.sortOrder,
        recipeQuantitySnapshot: new Prisma.Decimal(item.quantity),
        recipeUnitId: item.unitId,
        inventoryQuantity,
        inventoryUnitId: product.inventoryUnitId,
        conversionFactorSnapshot,
      });
    }
    return snapshots;
  }

  private async factorToInventory(client: TransactionClient, productId: string, unitId: string): Promise<Prisma.Decimal> {
    const rows = await client.$queryRaw<Array<{ factor: Prisma.Decimal }>>(Prisma.sql`
      SELECT "product_unit_factor_to_inventory"(${productId}, ${unitId}) AS factor
    `);
    const factor = rows[0]?.factor;
    if (factor === undefined || factor.lte(0)) {
      throw new ProductionLifecycleValidationError("Production Recipe has no active Product conversion.");
    }
    return factor;
  }

  private async lockActiveRecipe(client: TransactionClient, id: string): Promise<ActiveRecipe | null> {
    const rows = await client.$queryRaw<ActiveRecipe[]>(Prisma.sql`
      SELECT "id", "rootRecipeId", "revision", "outputProductId", "yieldQuantity", "yieldUnitId"
      FROM "Recipe"
      WHERE "id" = ${id} AND "status" = 'ACTIVE'::"RecipeStatus"
      FOR SHARE
    `);
    return rows[0] ?? null;
  }

  private lockActiveProducts(client: TransactionClient, ids: string[]): Promise<ActiveProduct[]> {
    return client.$queryRaw<ActiveProduct[]>(Prisma.sql`
      SELECT "id", "baseUnitId", "inventoryUnitId"
      FROM "Product"
      WHERE "id" IN (${Prisma.join(ids)})
        AND "status" = 'ACTIVE'::"MasterStatus"
        AND "deletedAt" IS NULL
      ORDER BY "id"
      FOR SHARE
    `);
  }

  private lockActiveUnits(client: TransactionClient, ids: string[]): Promise<Array<{ id: string }>> {
    return client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Unit"
      WHERE "id" IN (${Prisma.join(ids)})
        AND "status" = 'ACTIVE'::"MasterStatus"
      ORDER BY "id"
      FOR SHARE
    `);
  }

  private async lockActiveConversions(client: TransactionClient, productIds: string[]): Promise<void> {
    await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ProductUnitConversion"
      WHERE "productId" IN (${Prisma.join(productIds)})
        AND "status" = 'ACTIVE'::"MasterStatus"
      ORDER BY "productId", "unitId"
      FOR SHARE
    `);
  }

  private async lockConsumptionIds(client: TransactionClient, productionId: string): Promise<string[]> {
    const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ProductionConsumption"
      WHERE "productionId" = ${productionId}
      ORDER BY "id" FOR NO KEY UPDATE
    `);
    return rows.map((row) => row.id);
  }

  private async lockProduction(
    client: TransactionClient,
    id: string,
  ): Promise<{ id: string; status: ProductionLifecycleStatus } | null> {
    const rows = await client.$queryRaw<Array<{ id: string; status: ProductionLifecycleStatus }>>(Prisma.sql`
      SELECT "id", "status" FROM "Production" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private productionDate(value: string): Date {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new ProductionLifecycleValidationError("productionDate must be an ISO date string.");
    }
    return new Date(value);
  }

  private positiveDecimal(value: string, label: string): Prisma.Decimal {
    if (typeof value !== "string" || !DECIMAL_24_9.test(value)) {
      throw new ProductionLifecycleValidationError(`${label} must be a positive decimal string with at most 9 fractional digits.`);
    }
    const decimal = new Prisma.Decimal(value);
    if (decimal.lte(0)) {
      throw new ProductionLifecycleValidationError(`${label} must be a positive decimal string.`);
    }
    return decimal;
  }

  private async getOrThrow(client: ProductionClient, id: string): Promise<ProductionView> {
    const production = await this.load(client, id);
    if (production === null) throw new ProductionLifecycleValidationError(`Production ${id} could not be reloaded.`);
    return this.view(production);
  }

  private load(client: ProductionClient, id: string): Promise<ProductionRow | null> {
    return client.production.findUnique({
      where: { id },
      include: {
        recipe: { select: { id: true, rootRecipeId: true, revision: true } },
        consumptions: { orderBy: [{ lineNumber: "asc" }, { id: "asc" }] },
      },
    });
  }

  private view(production: ProductionRow): ProductionView {
    return {
      id: production.id,
      recipe: production.recipe,
      productionDate: production.productionDate,
      plannedQuantity: production.plannedQuantity.toString(),
      actualQuantity: production.actualQuantity?.toString() ?? null,
      status: production.status,
      note: production.note,
      postedAt: production.postedAt,
      cancelledAt: production.cancelledAt,
      createdAt: production.createdAt,
      updatedAt: production.updatedAt,
      output: {
        productId: production.outputProductIdSnapshot,
        yieldQuantity: production.yieldQuantitySnapshot.toString(),
        unitId: production.outputUnitIdSnapshot,
        conversionFactor: production.outputConversionFactorSnapshot.toString(),
      },
      consumptions: production.consumptions.map((consumption): ProductionConsumptionView => ({
        id: consumption.id,
        lineNumber: consumption.lineNumber,
        productId: consumption.productId,
        recipeQuantitySnapshot: consumption.recipeQuantitySnapshot.toString(),
        recipeUnitId: consumption.recipeUnitId,
        inventoryQuantity: consumption.inventoryQuantity.toString(),
        inventoryUnitId: consumption.inventoryUnitId,
        conversionFactorSnapshot: consumption.conversionFactorSnapshot.toString(),
        unitCostSnapshot: consumption.unitCostSnapshot.toString(),
        amountSnapshot: consumption.amountSnapshot.toString(),
        currency: consumption.currency,
      })),
    };
  }
}
