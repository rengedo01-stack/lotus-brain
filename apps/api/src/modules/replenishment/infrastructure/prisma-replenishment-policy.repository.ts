import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  CreateReplenishmentPolicyInput,
  ReplenishmentPolicyContextView,
  ReplenishmentPolicyRepository,
  ReplenishmentPolicyView,
  UpdateReplenishmentPolicyInput,
} from "../application/replenishment-policy.repository";
import { ReplenishmentPolicyValidationError } from "../application/replenishment-policy.errors";

type LockedProduct = { id: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };

@Injectable()
export class PrismaReplenishmentPolicyRepository implements ReplenishmentPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(productId: string): Promise<ReplenishmentPolicyContextView | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        inventoryUnit: { select: { code: true, name: true, symbol: true } },
        replenishmentPolicy: true,
      },
    });
    if (product === null) return null;
    return {
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        status: product.status,
        isDeleted: product.deletedAt !== null,
        inventoryUnit: product.inventoryUnit,
      },
      policy: product.replenishmentPolicy === null ? null : this.mapPolicy(product.replenishmentPolicy),
    };
  }

  async create(productId: string, input: CreateReplenishmentPolicyInput): Promise<ReplenishmentPolicyView | "NOT_FOUND" | "CONFLICT"> {
    const reorderPointQuantity = this.parseReorderPoint(input.reorderPointQuantity);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, productId);
      if (product === null) return "NOT_FOUND";
      if (!this.isActive(product)) return "CONFLICT";
      const existing = await tx.replenishmentPolicy.findUnique({ where: { productId } });
      if (existing !== null) return "CONFLICT";
      const created = await tx.replenishmentPolicy.create({
        data: { productId, reorderPointQuantity },
      });
      return this.mapPolicy(created);
    });
  }

  async update(productId: string, input: UpdateReplenishmentPolicyInput): Promise<ReplenishmentPolicyView | "NOT_FOUND" | "CONFLICT"> {
    const reorderPointQuantity = this.parseReorderPoint(input.reorderPointQuantity);
    return this.prisma.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, productId);
      if (product === null) return "NOT_FOUND";
      if (!this.isActive(product)) return "CONFLICT";
      const current = await tx.replenishmentPolicy.findUnique({ where: { productId } });
      if (current === null) return "NOT_FOUND";
      if (current.version !== input.expectedVersion) return "CONFLICT";
      const updated = await tx.replenishmentPolicy.update({
        where: { id: current.id },
        data: { reorderPointQuantity, version: { increment: 1 } },
      });
      return this.mapPolicy(updated);
    });
  }

  private async lockProduct(tx: Prisma.TransactionClient, productId: string): Promise<LockedProduct | null> {
    const rows = await tx.$queryRaw<LockedProduct[]>(Prisma.sql`
      SELECT "id", "status", "deletedAt"
      FROM "Product"
      WHERE "id" = ${productId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private isActive(product: LockedProduct): boolean {
    return product.status === "ACTIVE" && product.deletedAt === null;
  }

  private parseReorderPoint(value: string): Prisma.Decimal {
    if (!/^(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/.test(value)) {
      throw new ReplenishmentPolicyValidationError("reorderPointQuantity must be a non-negative Decimal(24,9) string.");
    }
    return new Prisma.Decimal(value);
  }

  private mapPolicy(value: {
    id: string;
    productId: string;
    reorderPointQuantity: Prisma.Decimal;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): ReplenishmentPolicyView {
    return {
      id: value.id,
      productId: value.productId,
      reorderPointQuantity: value.reorderPointQuantity.toString(),
      version: value.version,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }
}
