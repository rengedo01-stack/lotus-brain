import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MasterValidationError } from "../application/master.errors";
import type {
  CommercialTermsInput,
  ProductSupplierCommercialTermsContextView,
  ProductSupplierCommercialTermsRepository,
  UpdateCommercialTermsInput,
} from "../application/product-supplier-commercial-terms.repository";

type LockedMasterRow = { id: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
type LockedRelationshipRow = { id: string; productId: string; supplierId: string; status: "ACTIVE" | "DISABLED" };
type LockedTermsRow = { id: string; version: number };

const UNIT_PRICE_PATTERN = /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/;
const TAX_RATE_PATTERN = /^(?:0(?:\.[0-9]{1,4})?|1(?:\.0{1,4})?)$/;

@Injectable()
export class PrismaProductSupplierCommercialTermsRepository implements ProductSupplierCommercialTermsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(relationshipId: string): Promise<ProductSupplierCommercialTermsContextView | null> {
    const relationship = await this.prisma.productSupplyRelationship.findUnique({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        commercialTerms: true,
      },
    });
    return relationship === null ? null : this.mapContext(relationship);
  }

  async create(
    relationshipId: string,
    input: CommercialTermsInput,
  ): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT"> {
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
      if (!this.isActive(product) || !this.isActive(supplier) || relationship.status !== "ACTIVE") return "CONFLICT";

      const current = await this.lockTerms(tx, relationshipId);
      if (current !== null) return "CONFLICT";
      await tx.productSupplierCommercialTerms.create({ data: { relationshipId, ...values } });
      return this.loadContext(tx, relationshipId);
    });
  }

  async update(
    relationshipId: string,
    input: UpdateCommercialTermsInput,
  ): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT"> {
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
      if (!this.isActive(product) || !this.isActive(supplier) || relationship.status !== "ACTIVE") return "CONFLICT";

      const current = await this.lockTerms(tx, relationshipId);
      if (current === null) return "NOT_FOUND";
      if (current.version !== input.expectedVersion) return "CONFLICT";
      await tx.productSupplierCommercialTerms.update({
        where: { id: current.id },
        data: { ...values, version: { increment: 1 } },
      });
      return this.loadContext(tx, relationshipId);
    });
  }

  async clear(
    relationshipId: string,
    expectedVersion: number,
  ): Promise<ProductSupplierCommercialTermsContextView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({
        where: { id: relationshipId },
        select: { productId: true, supplierId: true },
      });
      if (identity === null) return "NOT_FOUND";

      // Cleanup deliberately follows the same order but does not require
      // current eligibility. A disabled relationship must retain, and may
      // safely clear, its current commercial configuration.
      await this.lockProduct(tx, identity.productId);
      await this.lockSupplier(tx, identity.supplierId);
      const relationship = await this.lockRelationship(tx, relationshipId);
      if (relationship === null) return "NOT_FOUND";

      const current = await this.lockTerms(tx, relationshipId);
      if (current === null || current.version !== expectedVersion) return "CONFLICT";
      await tx.productSupplierCommercialTerms.delete({ where: { id: current.id } });
      return this.loadContext(tx, relationshipId);
    });
  }

  private async loadContext(
    tx: Prisma.TransactionClient,
    relationshipId: string,
  ): Promise<ProductSupplierCommercialTermsContextView> {
    const relationship = await tx.productSupplyRelationship.findUniqueOrThrow({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        commercialTerms: true,
      },
    });
    return this.mapContext(relationship);
  }

  private parseInput(input: CommercialTermsInput): { unitPrice: Prisma.Decimal; currencyCode: "JPY"; taxRate: Prisma.Decimal } {
    if (input.currencyCode !== "JPY") {
      throw new MasterValidationError("currencyCode must be JPY.");
    }
    if (typeof input.unitPrice !== "string" || !UNIT_PRICE_PATTERN.test(input.unitPrice)) {
      throw new MasterValidationError("unitPrice must be a canonical non-negative Decimal(20,6) string.");
    }
    if (typeof input.taxRate !== "string" || !TAX_RATE_PATTERN.test(input.taxRate)) {
      throw new MasterValidationError("taxRate must be a canonical Decimal(5,4) string from 0 through 1.");
    }
    const unitPrice = new Prisma.Decimal(input.unitPrice);
    const taxRate = new Prisma.Decimal(input.taxRate);
    if (unitPrice.isNegative() || taxRate.isNegative() || taxRate.greaterThan(1)) {
      throw new MasterValidationError("Commercial price or tax rate is outside the supported range.");
    }
    return { unitPrice, currencyCode: "JPY", taxRate };
  }

  private async lockProduct(tx: Prisma.TransactionClient, id: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id", "status", "deletedAt" FROM "Product" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockSupplier(tx: Prisma.TransactionClient, id: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id", "status", "deletedAt" FROM "Supplier" WHERE "id" = ${id} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockRelationship(tx: Prisma.TransactionClient, id: string): Promise<LockedRelationshipRow | null> {
    const rows = await tx.$queryRaw<LockedRelationshipRow[]>(Prisma.sql`
      SELECT "id", "productId", "supplierId", "status"
      FROM "ProductSupplyRelationship"
      WHERE "id" = ${id}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockTerms(tx: Prisma.TransactionClient, relationshipId: string): Promise<LockedTermsRow | null> {
    const rows = await tx.$queryRaw<LockedTermsRow[]>(Prisma.sql`
      SELECT "id", "version"
      FROM "ProductSupplierCommercialTerms"
      WHERE "relationshipId" = ${relationshipId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private isActive(value: LockedMasterRow): boolean {
    return value.status === "ACTIVE" && value.deletedAt === null;
  }

  private mapContext(value: {
    id: string;
    status: "ACTIVE" | "DISABLED";
    version: number;
    product: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null; inventoryUnit: { code: string; name: string; symbol: string } };
    supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
    commercialTerms: { id: string; relationshipId: string; unitPrice: Prisma.Decimal; currencyCode: string; taxRate: Prisma.Decimal; version: number; createdAt: Date; updatedAt: Date } | null;
  }): ProductSupplierCommercialTermsContextView {
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
      terms: value.commercialTerms === null ? null : {
        id: value.commercialTerms.id,
        relationshipId: value.commercialTerms.relationshipId,
        unitPrice: value.commercialTerms.unitPrice.toFixed(6),
        currencyCode: "JPY",
        taxRate: value.commercialTerms.taxRate.toFixed(4),
        version: value.commercialTerms.version,
        createdAt: value.commercialTerms.createdAt,
        updatedAt: value.commercialTerms.updatedAt,
      },
    };
  }
}
