import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  type ListStocktakesQuery,
  type StocktakeListItemView,
  type StocktakeListPage,
  type StocktakeListRepository,
} from "../application/stocktake-list.repository";

type StocktakeListRow = Prisma.StocktakeGetPayload<{
  select: {
    id: true;
    status: true;
    startedAt: true;
    completedAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

@Injectable()
export class PrismaStocktakeListRepository implements StocktakeListRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListStocktakesQuery): Promise<StocktakeListPage> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.createdFrom !== undefined) createdAt.gte = query.createdFrom;
    if (query.createdTo !== undefined) createdAt.lte = query.createdTo;

    const where: Prisma.StocktakeWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(Object.keys(createdAt).length === 0 ? {} : { createdAt }),
    };
    if (query.cursor !== undefined) {
      where.AND = [{
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      }];
    }

    const rows = await this.prisma.stocktake.findMany({
      where,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => this.map(row)),
      nextCursor: rows.length > query.limit && last !== undefined
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    };
  }

  private map(row: StocktakeListRow): StocktakeListItemView {
    return {
      id: row.id,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
