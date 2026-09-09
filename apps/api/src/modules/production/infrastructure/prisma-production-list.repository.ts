import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  type ListProductionsQuery,
  type ProductionListItemView,
  type ProductionListPage,
  type ProductionListRepository,
} from "../application/production-list.repository";

type ProductionListRow = Prisma.ProductionGetPayload<{
  select: {
    id: true;
    status: true;
    productionDate: true;
    outputProductIdSnapshot: true;
    postedAt: true;
    cancelledAt: true;
    recipe: { select: { id: true; rootRecipeId: true; revision: true } };
  };
}>;

@Injectable()
export class PrismaProductionListRepository implements ProductionListRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductionsQuery): Promise<ProductionListPage> {
    const productionDate: Prisma.DateTimeFilter = {};
    if (query.from !== undefined) productionDate.gte = query.from;
    if (query.to !== undefined) productionDate.lte = query.to;

    const where: Prisma.ProductionWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.recipeId === undefined ? {} : { recipeId: query.recipeId }),
      ...(query.outputProductIdSnapshot === undefined ? {} : { outputProductIdSnapshot: query.outputProductIdSnapshot }),
      ...(Object.keys(productionDate).length === 0 ? {} : { productionDate }),
    };
    if (query.cursor !== undefined) {
      where.AND = [{
        OR: [
          { productionDate: { lt: query.cursor.productionDate } },
          { productionDate: query.cursor.productionDate, id: { lt: query.cursor.id } },
        ],
      }];
    }

    const rows = await this.prisma.production.findMany({
      where,
      select: {
        id: true,
        status: true,
        productionDate: true,
        outputProductIdSnapshot: true,
        postedAt: true,
        cancelledAt: true,
        recipe: { select: { id: true, rootRecipeId: true, revision: true } },
      },
      orderBy: [{ productionDate: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.map(row)),
      nextCursor: rows.length > query.limit && last !== undefined
        ? { productionDate: last.productionDate, id: last.id }
        : null,
    };
  }

  private map(row: ProductionListRow): ProductionListItemView {
    return {
      id: row.id,
      status: row.status,
      productionDate: row.productionDate,
      outputProductIdSnapshot: row.outputProductIdSnapshot,
      recipe: {
        id: row.recipe.id,
        rootRecipeId: row.recipe.rootRecipeId,
        revision: row.recipe.revision,
      },
      postedAt: row.postedAt,
      cancelledAt: row.cancelledAt,
    };
  }
}
