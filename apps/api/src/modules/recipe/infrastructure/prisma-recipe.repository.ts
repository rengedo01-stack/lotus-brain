import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient, RecipeStatus as PrismaRecipeStatus } from "../../../generated/prisma/client";
import type { TransactionClient } from "../../../generated/prisma/internal/prismaNamespace";
import { PrismaService } from "../../../prisma/prisma.service";
import { RecipeValidationError } from "../application/recipe.errors";
import {
  type RecipeDraftInput,
  type RecipeListQuery,
  type RecipeRepository,
  type RecipeStatus,
  type RecipeView,
} from "../application/recipe.repository";

type RecipeClient = PrismaClient | TransactionClient;

type RecipeRow = {
  id: string;
  name: string;
  outputProductId: string;
  yieldQuantity: Prisma.Decimal;
  yieldUnitId: string;
  status: PrismaRecipeStatus;
  revision: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string;
    unitId: string;
    quantity: Prisma.Decimal;
    sortOrder: number;
  }>;
};

type ProductReference = {
  id: string;
  baseUnitId: string;
  inventoryUnitId: string;
};

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

@Injectable()
export class PrismaRecipeRepository implements RecipeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(input: RecipeDraftInput): Promise<RecipeView> {
    return this.prisma.$transaction(async (client) => {
      const outputProduct = await this.lockActiveOutputProduct(client, input.outputProductId);
      const draft = await this.normalizeDraft(client, input, outputProduct);
      const revision = await this.nextRevision(client, outputProduct.id);
      return this.writeDraft(client, draft, revision);
    });
  }

  async get(id: string): Promise<RecipeView | null> {
    const recipe = await this.load(this.prisma, id);
    return recipe === null ? null : this.view(recipe);
  }

  async list(query: RecipeListQuery): Promise<RecipeView[]> {
    const recipes = await this.prisma.recipe.findMany({
      where: query.status === undefined ? undefined : { status: query.status },
      orderBy: [{ outputProductId: "asc" }, { revision: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return recipes.map((recipe) => this.view(recipe));
  }

  async updateDraft(id: string, input: RecipeDraftInput): Promise<RecipeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const current = await this.lockRecipe(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT" || await this.hasProductionReference(client, id)) return "CONFLICT";

      const draft = await this.normalizeDraft(client, input);
      await client.recipeItem.deleteMany({ where: { recipeId: id } });
      const recipe = await client.recipe.update({
        where: { id },
        data: {
          name: draft.name,
          outputProductId: draft.outputProductId,
          yieldQuantity: draft.yieldQuantity,
          yieldUnitId: draft.yieldUnitId,
          note: draft.note,
          items: { create: draft.items },
        },
        include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      return this.view(recipe);
    });
  }

  async activate(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const current = await this.lockRecipe(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "DRAFT") return "CONFLICT";

      const recipe = await this.load(client, id);
      if (recipe === null || recipe.items.length === 0) return "CONFLICT";
      await this.normalizeDraft(client, {
        name: recipe.name,
        outputProductId: recipe.outputProductId,
        yieldQuantity: recipe.yieldQuantity.toString(),
        yieldUnitId: recipe.yieldUnitId,
        note: recipe.note,
        items: recipe.items.map((item) => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity.toString(),
        })),
      });

      const activated = await client.recipe.update({
        where: { id },
        data: { status: "ACTIVE" },
        include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      return this.view(activated);
    });
  }

  async archive(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const current = await this.lockRecipe(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status !== "ACTIVE") return "CONFLICT";

      const archived = await client.recipe.update({
        where: { id },
        data: { status: "ARCHIVED" },
        include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      return this.view(archived);
    });
  }

  async createRevision(id: string): Promise<RecipeView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (client) => {
      const current = await this.lockRecipe(client, id);
      if (current === null) return "NOT_FOUND";
      if (current.status === "DRAFT") return "CONFLICT";

      const source = await this.load(client, id);
      if (source === null) return "NOT_FOUND";
      const outputProduct = await this.lockActiveOutputProduct(client, source.outputProductId);
      const draft = await this.normalizeDraft(client, {
        name: source.name,
        outputProductId: source.outputProductId,
        yieldQuantity: source.yieldQuantity.toString(),
        yieldUnitId: source.yieldUnitId,
        note: source.note,
        items: source.items.map((item) => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity.toString(),
        })),
      }, outputProduct);
      const revision = await this.nextRevision(client, outputProduct.id);
      return this.writeDraft(client, draft, revision);
    });
  }

  private async writeDraft(
    client: TransactionClient,
    draft: { name: string; outputProductId: string; yieldQuantity: Prisma.Decimal; yieldUnitId: string; note: string | null; items: Array<{ productId: string; unitId: string; quantity: Prisma.Decimal; sortOrder: number }> },
    revision: number,
  ): Promise<RecipeView> {
    const recipe = await client.recipe.create({
      data: {
        name: draft.name,
        outputProductId: draft.outputProductId,
        yieldQuantity: draft.yieldQuantity,
        yieldUnitId: draft.yieldUnitId,
        status: "DRAFT",
        revision,
        note: draft.note,
        items: { create: draft.items },
      },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return this.view(recipe);
  }

  private async normalizeDraft(
    client: RecipeClient,
    input: RecipeDraftInput,
    lockedOutputProduct?: ProductReference,
  ): Promise<{ name: string; outputProductId: string; yieldQuantity: Prisma.Decimal; yieldUnitId: string; note: string | null; items: Array<{ productId: string; unitId: string; quantity: Prisma.Decimal; sortOrder: number }> }> {
    const name = input.name.trim();
    if (name.length === 0) throw new RecipeValidationError("Recipe name is required.");
    const yieldQuantity = this.positiveDecimal(input.yieldQuantity, "yieldQuantity");
    const outputProduct = lockedOutputProduct ?? await this.findActiveProduct(client, input.outputProductId);
    await this.ensureCompatibleActiveUnit(client, outputProduct, input.yieldUnitId, "Recipe output unit");

    const items = await Promise.all(input.items.map(async (item, index) => {
      const product = await this.findActiveProduct(client, item.productId);
      await this.ensureCompatibleActiveUnit(client, product, item.unitId, "Recipe item unit");
      return {
        productId: item.productId,
        unitId: item.unitId,
        quantity: this.positiveDecimal(item.quantity, "Recipe item quantity"),
        sortOrder: index,
      };
    }));

    return {
      name,
      outputProductId: outputProduct.id,
      yieldQuantity,
      yieldUnitId: input.yieldUnitId,
      note: input.note ?? null,
      items,
    };
  }

  private positiveDecimal(value: string, label: string): Prisma.Decimal {
    if (!DECIMAL.test(value)) throw new RecipeValidationError(`${label} must be a positive decimal string.`);
    const decimal = new Prisma.Decimal(value);
    if (decimal.lte(0)) throw new RecipeValidationError(`${label} must be a positive decimal string.`);
    return decimal;
  }

  private async findActiveProduct(client: RecipeClient, id: string): Promise<ProductReference> {
    const product = await client.product.findFirst({
      where: { id, status: "ACTIVE", deletedAt: null },
      select: { id: true, baseUnitId: true, inventoryUnitId: true },
    });
    if (product === null) throw new RecipeValidationError("Recipe Product must be active.");
    return product;
  }

  private async lockActiveOutputProduct(client: TransactionClient, id: string): Promise<ProductReference> {
    const rows = await client.$queryRaw<ProductReference[]>(Prisma.sql`
      SELECT "id", "baseUnitId", "inventoryUnitId"
      FROM "Product"
      WHERE "id" = ${id} AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
      FOR UPDATE
    `);
    const product = rows[0];
    if (product === undefined) throw new RecipeValidationError("Recipe output Product must be active.");
    return product;
  }

  private async ensureCompatibleActiveUnit(
    client: RecipeClient,
    product: ProductReference,
    unitId: string,
    label: string,
  ): Promise<void> {
    const unitIds = [...new Set([product.baseUnitId, product.inventoryUnitId, unitId])];
    const units = await client.unit.findMany({
      where: { id: { in: unitIds }, status: "ACTIVE" },
      select: { id: true },
    });
    if (units.length !== unitIds.length) throw new RecipeValidationError(`${label} must be active.`);

    for (const candidateUnitId of [unitId, product.inventoryUnitId]) {
      if (candidateUnitId === product.baseUnitId) continue;
      const conversion = await client.productUnitConversion.findFirst({
        where: { productId: product.id, unitId: candidateUnitId, status: "ACTIVE" },
        select: { id: true },
      });
      if (conversion === null) throw new RecipeValidationError(`${label} has no active Product conversion.`);
    }
  }

  private async nextRevision(client: TransactionClient, outputProductId: string): Promise<number> {
    const current = await client.recipe.aggregate({
      where: { outputProductId },
      _max: { revision: true },
    });
    return (current._max.revision ?? 0) + 1;
  }

  private async lockRecipe(client: TransactionClient, id: string): Promise<{ id: string; status: RecipeStatus } | null> {
    const rows = await client.$queryRaw<Array<{ id: string; status: RecipeStatus }>>(Prisma.sql`
      SELECT "id", "status" FROM "Recipe" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async hasProductionReference(client: TransactionClient, recipeId: string): Promise<boolean> {
    const production = await client.production.findFirst({ where: { recipeId }, select: { id: true } });
    return production !== null;
  }

  private async load(client: RecipeClient, id: string): Promise<RecipeRow | null> {
    return client.recipe.findUnique({
      where: { id },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
  }

  private view(recipe: RecipeRow): RecipeView {
    return {
      id: recipe.id,
      name: recipe.name,
      outputProductId: recipe.outputProductId,
      yieldQuantity: recipe.yieldQuantity.toString(),
      yieldUnitId: recipe.yieldUnitId,
      status: recipe.status,
      revision: recipe.revision,
      note: recipe.note,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
      items: recipe.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        unitId: item.unitId,
        quantity: item.quantity.toString(),
        sortOrder: item.sortOrder,
      })),
    };
  }
}
