import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  type ListPurchasesQuery,
  type PurchaseListItemView,
  type PurchaseListPage,
  type PurchaseListRepository,
} from "../application/purchase-list.repository";

type PurchaseListRow = Prisma.PurchaseGetPayload<{
  include: { supplier: { select: { code: true; name: true } } };
}>;

@Injectable()
export class PrismaPurchaseListRepository implements PurchaseListRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListPurchasesQuery): Promise<PurchaseListPage> {
    const purchaseDate: Prisma.DateTimeFilter = {};
    if (query.from !== undefined) purchaseDate.gte = query.from;
    if (query.to !== undefined) purchaseDate.lte = query.to;

    const where: Prisma.PurchaseWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.supplierCode === undefined ? {} : { supplier: { is: { code: query.supplierCode } } }),
      ...(query.documentNumber === undefined ? {} : { documentNumber: query.documentNumber }),
      ...(Object.keys(purchaseDate).length === 0 ? {} : { purchaseDate }),
    };

    if (query.cursor !== undefined) {
      where.AND = [
        {
          OR: [
            { purchaseDate: { lt: query.cursor.purchaseDate } },
            { purchaseDate: query.cursor.purchaseDate, id: { lt: query.cursor.id } },
          ],
        },
      ];
    }

    const rows = await this.prisma.purchase.findMany({
      where,
      include: { supplier: { select: { code: true, name: true } } },
      orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => this.map(row)),
      nextCursor: rows.length > query.limit && last !== undefined
        ? { purchaseDate: last.purchaseDate, id: last.id }
        : null,
    };
  }

  private map(row: PurchaseListRow): PurchaseListItemView {
    return {
      id: row.id,
      status: row.status,
      purchaseDate: row.purchaseDate,
      documentNumber: row.documentNumber,
      postedAt: row.postedAt,
      cancelledAt: row.cancelledAt,
      supplier: { code: row.supplier.code, name: row.supplier.name },
    };
  }
}
