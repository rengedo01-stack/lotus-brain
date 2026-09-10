import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MasterValidationError } from "../application/master.errors";
import type {
  ProductSupplierPackageContextView,
  ProductSupplierPackageInput,
  ProductSupplierPackageRepository,
  ProductSupplierPackagesContextView,
  UpdateProductSupplierPackageInput,
} from "../application/product-supplier-package.repository";

type LockedMasterRow = { id: string };
type LockedRelationshipRow = { id: string; productId: string; supplierId: string };
type LockedPackageRow = { id: string; version: number };

@Injectable()
export class PrismaProductSupplierPackageRepository implements ProductSupplierPackageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(relationshipId: string): Promise<ProductSupplierPackagesContextView | null> {
    const relationship = await this.prisma.productSupplyRelationship.findUnique({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        packages: { orderBy: [{ code: "asc" }, { id: "asc" }] },
      },
    });
    return relationship === null ? null : this.mapPackagesContext(relationship);
  }

  async get(relationshipId: string, packageId: string): Promise<ProductSupplierPackageContextView | null> {
    const relationship = await this.prisma.productSupplyRelationship.findUnique({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        packages: { where: { id: packageId } },
      },
    });
    if (relationship === null || relationship.packages.length !== 1) return null;
    return this.mapPackageContext(relationship, relationship.packages[0]);
  }

  async create(
    relationshipId: string,
    input: ProductSupplierPackageInput,
  ): Promise<ProductSupplierPackageContextView | "NOT_FOUND" | "CONFLICT"> {
    const values = this.parseInput(input);
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({
        where: { id: relationshipId },
        select: { productId: true, supplierId: true },
      });
      if (identity === null) return "NOT_FOUND";

      // Match C8/C9: Product → Supplier → relationship. The relationship row
      // serializes package creates and lifecycle edits for this durable pair.
      const product = await this.lockProduct(tx, identity.productId);
      const supplier = await this.lockSupplier(tx, identity.supplierId);
      const relationship = await this.lockRelationship(tx, relationshipId);
      if (product === null || supplier === null || relationship === null) return "CONFLICT";

      const duplicate = await tx.productSupplierPackage.findUnique({
        where: { relationshipId_code: { relationshipId, code: values.code } },
        select: { id: true },
      });
      if (duplicate !== null) return "CONFLICT";

      const created = await tx.productSupplierPackage.create({
        data: { relationshipId, ...values },
      });
      return this.loadPackageContext(tx, relationshipId, created.id);
    });
  }

  async update(
    relationshipId: string,
    packageId: string,
    input: UpdateProductSupplierPackageInput,
  ): Promise<ProductSupplierPackageContextView | "NOT_FOUND" | "CONFLICT"> {
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

      const current = await this.lockPackage(tx, relationshipId, packageId);
      if (current === null) return "NOT_FOUND";
      if (current.version !== input.expectedVersion) return "CONFLICT";

      await tx.productSupplierPackage.update({
        where: { id: packageId },
        data: { ...values, version: { increment: 1 } },
      });
      return this.loadPackageContext(tx, relationshipId, packageId);
    });
  }

  private async loadPackageContext(
    tx: Prisma.TransactionClient,
    relationshipId: string,
    packageId: string,
  ): Promise<ProductSupplierPackageContextView> {
    const relationship = await tx.productSupplyRelationship.findUniqueOrThrow({
      where: { id: relationshipId },
      include: {
        product: { include: { inventoryUnit: { select: { code: true, name: true, symbol: true } } } },
        supplier: true,
        packages: { where: { id: packageId } },
      },
    });
    if (relationship.packages.length !== 1) throw new MasterValidationError("The package no longer belongs to this supply relationship.");
    return this.mapPackageContext(relationship, relationship.packages[0]);
  }

  private parseInput(input: ProductSupplierPackageInput): {
    code: string;
    name: string;
    inventoryQuantityPerPackage: Prisma.Decimal;
    isOrderable: boolean;
    status: "ACTIVE" | "DISABLED";
  } {
    return {
      code: this.parseLabel(input.code, "code"),
      name: this.parseLabel(input.name, "name"),
      inventoryQuantityPerPackage: this.parsePositiveQuantity(input.inventoryQuantityPerPackage),
      isOrderable: input.isOrderable,
      status: input.status,
    };
  }

  private parseLabel(value: string, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new MasterValidationError(`${field} must be a non-empty string.`);
    }
    return value.trim();
  }

  private parsePositiveQuantity(value: string): Prisma.Decimal {
    if (typeof value !== "string" || !/^(?=.*[1-9])(?:0|[1-9][0-9]{0,14})(?:\.[0-9]{1,9})?$/.test(value)) {
      throw new MasterValidationError("inventoryQuantityPerPackage must be a positive Decimal(24,9) string.");
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

  private async lockPackage(
    tx: Prisma.TransactionClient,
    relationshipId: string,
    packageId: string,
  ): Promise<LockedPackageRow | null> {
    const rows = await tx.$queryRaw<LockedPackageRow[]>(Prisma.sql`
      SELECT "id", "version" FROM "ProductSupplierPackage"
      WHERE "id" = ${packageId} AND "relationshipId" = ${relationshipId} FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private mapPackagesContext(value: {
    id: string;
    status: "ACTIVE" | "DISABLED";
    version: number;
    product: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null; inventoryUnit: { code: string; name: string; symbol: string } };
    supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
    packages: Array<{ id: string; relationshipId: string; code: string; name: string; inventoryQuantityPerPackage: Prisma.Decimal; isOrderable: boolean; status: "ACTIVE" | "DISABLED"; version: number; createdAt: Date; updatedAt: Date }>;
  }): ProductSupplierPackagesContextView {
    return {
      relationship: this.mapRelationship(value),
      packages: value.packages.map((item) => this.mapPackage(item)),
    };
  }

  private mapPackageContext(
    relationship: {
      id: string;
      status: "ACTIVE" | "DISABLED";
      version: number;
      product: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null; inventoryUnit: { code: string; name: string; symbol: string } };
      supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
    },
    packageValue: { id: string; relationshipId: string; code: string; name: string; inventoryQuantityPerPackage: Prisma.Decimal; isOrderable: boolean; status: "ACTIVE" | "DISABLED"; version: number; createdAt: Date; updatedAt: Date },
  ): ProductSupplierPackageContextView {
    return { relationship: this.mapRelationship(relationship), package: this.mapPackage(packageValue) };
  }

  private mapRelationship(value: {
    id: string;
    status: "ACTIVE" | "DISABLED";
    version: number;
    product: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null; inventoryUnit: { code: string; name: string; symbol: string } };
    supplier: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
  }) {
    return {
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
    };
  }

  private mapPackage(value: {
    id: string;
    relationshipId: string;
    code: string;
    name: string;
    inventoryQuantityPerPackage: Prisma.Decimal;
    isOrderable: boolean;
    status: "ACTIVE" | "DISABLED";
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: value.id,
      relationshipId: value.relationshipId,
      code: value.code,
      name: value.name,
      inventoryQuantityPerPackage: value.inventoryQuantityPerPackage.toFixed(9),
      isOrderable: value.isOrderable,
      status: value.status,
      version: value.version,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }
}
