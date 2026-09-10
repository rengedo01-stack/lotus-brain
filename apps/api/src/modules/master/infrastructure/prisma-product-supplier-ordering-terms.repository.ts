import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MasterValidationError } from "../application/master.errors";
import type { ListQuery } from "../application/master.repository";
import type {
  OrderingTermsInput,
  ProductSupplierOrderingTermsContextView,
  ProductSupplierOrderingTermsRepository,
  UpdateOrderingTermsInput,
} from "../application/product-supplier-ordering-terms.repository";

type LockedMasterRow = { id: string };
type LockedRelationshipRow = { id: string; productId: string; supplierId: string };
type LockedTermsRow = { id: string; version: number };

@Injectable()
export class PrismaProductSupplierOrderingTermsRepository implements ProductSupplierOrderingTermsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(relationshipId: string): Promise<ProductSupplierOrderingTermsContextView | null> {
    const relationship = await this.prisma.productSupplyRelationship.findUnique({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        orderingTerms: true,
      },
    });
    return relationship === null ? null : this.mapContext(relationship);
  }

  async list(query: ListQuery): Promise<ProductSupplierOrderingTermsContextView[]> {
    const relationships = await this.prisma.productSupplyRelationship.findMany({
      where: { orderingTerms: { isNot: null } },
      orderBy: [{ productId: "asc" }, { supplierId: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        orderingTerms: true,
      },
    });
    return relationships.map((relationship) => this.mapContext(relationship));
  }

  async create(
    relationshipId: string,
    input: OrderingTermsInput,
  ): Promise<ProductSupplierOrderingTermsContextView | "NOT_FOUND" | "CONFLICT"> {
    const values = this.parseInput(input);
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({
        where: { id: relationshipId },
        select: { productId: true, supplierId: true },
      });
      if (identity === null) return "NOT_FOUND";

      // Match C8's Product → Supplier → relationship ordering. Terms are
      // locked last so a relationship lifecycle mutation cannot deadlock with
      // a current-terms mutation.
      const product = await this.lockProduct(tx, identity.productId);
      const supplier = await this.lockSupplier(tx, identity.supplierId);
      const relationship = await this.lockRelationship(tx, relationshipId);
      if (product === null || supplier === null || relationship === null) return "CONFLICT";

      const existing = await this.lockTerms(tx, relationshipId);
      if (existing !== null) return "CONFLICT";
      await tx.productSupplierOrderingTerms.create({
        data: { relationshipId, ...values },
      });
      return this.loadContext(tx, relationshipId);
    });
  }

  async update(
    relationshipId: string,
    input: UpdateOrderingTermsInput,
  ): Promise<ProductSupplierOrderingTermsContextView | "NOT_FOUND" | "CONFLICT"> {
    const values = this.parseInput(input);
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({
        where: { id: relationshipId },
        select: { productId: true, supplierId: true },
      });
      if (identity === null) return "NOT_FOUND";

      const product = await this.lockProduct(tx, identity.productId);
      const supplier = await this.lockSupplier(tx, identity.supplierId);
      const relationship = await this.lockRelationship(tx, relationshipId);
      if (product === null || supplier === null || relationship === null) return "CONFLICT";

      const current = await this.lockTerms(tx, relationshipId);
      if (current === null) return "NOT_FOUND";
      if (current.version !== input.expectedVersion) return "CONFLICT";

      await tx.productSupplierOrderingTerms.update({
        where: { id: current.id },
        data: { ...values, version: { increment: 1 } },
      });
      return this.loadContext(tx, relationshipId);
    });
  }

  private async loadContext(tx: Prisma.TransactionClient, relationshipId: string): Promise<ProductSupplierOrderingTermsContextView> {
    const relationship = await tx.productSupplyRelationship.findUniqueOrThrow({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        orderingTerms: true,
      },
    });
    return this.mapContext(relationship);
  }

  private parseInput(input: OrderingTermsInput): { minimumOrderQuantity: Prisma.Decimal | null; orderMultipleQuantity: Prisma.Decimal | null } {
    return {
      minimumOrderQuantity: this.parsePositiveQuantity(input.minimumOrderQuantity, "minimumOrderQuantity"),
      orderMultipleQuantity: this.parsePositiveQuantity(input.orderMultipleQuantity, "orderMultipleQuantity"),
    };
  }

  private parsePositiveQuantity(value: string | null, field: string): Prisma.Decimal | null {
    if (value === null) return null;
    if (!/^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/.test(value)) {
      throw new MasterValidationError(`${field} must be a positive Decimal(24,9) string or null.`);
    }
    return new Prisma.Decimal(value);
  }

  private async lockProduct(tx: Prisma.TransactionClient, productId: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockSupplier(tx: Prisma.TransactionClient, supplierId: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id" FROM "Supplier" WHERE "id" = ${supplierId} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockRelationship(tx: Prisma.TransactionClient, id: string): Promise<LockedRelationshipRow | null> {
    const rows = await tx.$queryRaw<LockedRelationshipRow[]>(Prisma.sql`
      SELECT "id", "productId", "supplierId" FROM "ProductSupplyRelationship" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockTerms(tx: Prisma.TransactionClient, relationshipId: string): Promise<LockedTermsRow | null> {
    const rows = await tx.$queryRaw<LockedTermsRow[]>(Prisma.sql`
      SELECT "id", "version" FROM "ProductSupplierOrderingTerms" WHERE "relationshipId" = ${relationshipId} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private mapContext(value: {
    id: string;
    status: "ACTIVE" | "DISABLED";
    version: number;
    product: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null; inventoryUnit: { code: string; name: string; symbol: string } };
    supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
    orderingTerms: { id: string; relationshipId: string; minimumOrderQuantity: Prisma.Decimal | null; orderMultipleQuantity: Prisma.Decimal | null; version: number; createdAt: Date; updatedAt: Date } | null;
  }): ProductSupplierOrderingTermsContextView {
    return {
      relationship: {
        id: value.id,
        status: value.status,
        version: value.version,
        product: {
          id: value.product.id,
          code: value.product.code,
          name: value.product.name,
          status: value.product.status,
          isDeleted: value.product.deletedAt !== null,
          inventoryUnit: value.product.inventoryUnit,
        },
        supplier: {
          id: value.supplier.id,
          code: value.supplier.code,
          name: value.supplier.name,
          status: value.supplier.status,
          isDeleted: value.supplier.deletedAt !== null,
        },
      },
      terms: value.orderingTerms === null ? null : {
        id: value.orderingTerms.id,
        relationshipId: value.orderingTerms.relationshipId,
        // Decimal#toString may emit scientific notation (for example 1e-9),
        // which is not this API's canonical Decimal(24,9) wire contract.
        minimumOrderQuantity: value.orderingTerms.minimumOrderQuantity?.toFixed(9) ?? null,
        orderMultipleQuantity: value.orderingTerms.orderMultipleQuantity?.toFixed(9) ?? null,
        version: value.orderingTerms.version,
        createdAt: value.orderingTerms.createdAt,
        updatedAt: value.orderingTerms.updatedAt,
      },
    };
  }
}
