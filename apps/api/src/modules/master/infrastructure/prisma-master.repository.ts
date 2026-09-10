import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import type { MasterStatus, ProductSupplyRelationshipStatus, UnitDimension } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MasterRequestError, MasterValidationError } from "../application/master.errors";
import {
  type ListQuery,
  type MasterRepository,
  type CreateProductSupplyRelationshipInput,
  type CreateProductSupplyRelationshipResult,
  type ProductUnitConversionInput,
  type ProductUnitConversionView,
  type ProductInput,
  type ProductUpdateInput,
  type ProductView,
  type SupplierInput,
  type SupplierUpdateInput,
  type SupplierView,
  type UnitInput,
  type UnitUpdateInput,
  type UnitView,
  type ProductSupplyRelationshipView,
  type UpdateProductSupplyRelationshipInput,
} from "../application/master.repository";

type ProductRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  baseUnitId: string;
  inventoryUnitId: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type UnitRow = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
};

type SupplierRow = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type ProductUnitConversionRow = {
  id: string;
  productId: string;
  unitId: string;
  factorToBaseUnit: Prisma.Decimal;
  status: MasterStatus;
  createdAt: Date;
  updatedAt: Date;
};

type LockedMasterRow = {
  id: string;
  status: MasterStatus;
  deletedAt: Date | null;
};

type LockedProductSupplyRelationshipRow = {
  id: string;
  productId: string;
  supplierId: string;
  status: ProductSupplyRelationshipStatus;
  version: number;
};

@Injectable()
export class PrismaMasterRepository implements MasterRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(input: ProductInput): Promise<ProductView> {
    await this.ensureUnitExists(input.baseUnitId);
    await this.ensureUnitExists(input.inventoryUnitId);

    const product = await this.prisma.product.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        baseUnitId: input.baseUnitId,
        inventoryUnitId: input.inventoryUnitId,
        status: input.status ?? "ACTIVE",
      },
    });
    return this.mapProduct(product);
  }

  async getProduct(id: string): Promise<ProductView | null> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    return product === null ? null : this.mapProduct(product);
  }

  async listProducts(query: ListQuery): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return products.map((product) => this.mapProduct(product));
  }

  async updateProduct(id: string, input: ProductUpdateInput): Promise<ProductView | "NOT_FOUND"> {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (current === null) return "NOT_FOUND";

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: input.name ?? current.name,
        description: input.description ?? current.description,
        status: input.status ?? current.status,
      },
    });
    return this.mapProduct(updated);
  }

  async createUnit(input: UnitInput): Promise<UnitView> {
    const unit = await this.prisma.unit.create({
      data: {
        code: input.code,
        name: input.name,
        symbol: input.symbol,
        dimension: input.dimension,
        status: input.status ?? "ACTIVE",
      },
    });
    return this.mapUnit(unit);
  }

  async getUnit(id: string): Promise<UnitView | null> {
    const unit = await this.prisma.unit.findUnique({ where: { id } });
    return unit === null ? null : this.mapUnit(unit);
  }

  async listUnits(query: ListQuery): Promise<UnitView[]> {
    const units = await this.prisma.unit.findMany({
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return units.map((unit) => this.mapUnit(unit));
  }

  async updateUnit(id: string, input: UnitUpdateInput): Promise<UnitView | "NOT_FOUND"> {
    const current = await this.prisma.unit.findUnique({ where: { id } });
    if (current === null) return "NOT_FOUND";

    const updated = await this.prisma.unit.update({
      where: { id },
      data: {
        status: input.status,
      },
    });
    return this.mapUnit(updated);
  }

  async createSupplier(input: SupplierInput): Promise<SupplierView> {
    const supplier = await this.prisma.supplier.create({
      data: {
        code: input.code,
        name: input.name,
        status: input.status ?? "ACTIVE",
      },
    });
    return this.mapSupplier(supplier);
  }

  async getSupplier(id: string): Promise<SupplierView | null> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    return supplier === null ? null : this.mapSupplier(supplier);
  }

  async listSuppliers(query: ListQuery): Promise<SupplierView[]> {
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return suppliers.map((supplier) => this.mapSupplier(supplier));
  }

  async updateSupplier(id: string, input: SupplierUpdateInput): Promise<SupplierView | "NOT_FOUND"> {
    const current = await this.prisma.supplier.findUnique({ where: { id } });
    if (current === null) return "NOT_FOUND";

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        name: input.name ?? current.name,
        status: input.status ?? current.status,
      },
    });
    return this.mapSupplier(updated);
  }

  async createProductUnitConversion(
    productId: string,
    input: ProductUnitConversionInput,
  ): Promise<ProductUnitConversionView> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        baseUnitId: true,
        inventoryUnitId: true,
        baseUnit: { select: { dimension: true } },
      },
    });
    if (product === null) {
      throw new MasterValidationError(`Product ${productId} was not found.`);
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, dimension: true },
    });
    if (unit === null) {
      throw new MasterValidationError(`Unit ${input.unitId} was not found.`);
    }

    if (unit.dimension !== product.baseUnit.dimension) {
      throw new MasterValidationError(`Unit ${input.unitId} is not dimension-compatible with Product ${productId}.`);
    }

    if (unit.id === product.baseUnitId) {
      throw new MasterValidationError(`Product ${productId} must not define an explicit identity conversion for its base unit ${input.unitId}.`);
    }

    const factor = this.parseDecimal(input.factorToBaseUnit, "factorToBaseUnit");
    if (factor.lte(0)) {
      throw new MasterValidationError("Conversion factor must be greater than zero.");
    }

    const created = await this.prisma.productUnitConversion.create({
      data: {
        productId,
        unitId: input.unitId,
        factorToBaseUnit: factor,
        status: input.status ?? "ACTIVE",
      },
    });
    return this.mapProductUnitConversion(created);
  }

  async getProductUnitConversion(productId: string, id: string): Promise<ProductUnitConversionView | null> {
    const conversion = await this.prisma.productUnitConversion.findFirst({
      where: { id, productId },
    });
    return conversion === null ? null : this.mapProductUnitConversion(conversion);
  }

  async listProductUnitConversions(productId: string): Promise<ProductUnitConversionView[]> {
    const conversions = await this.prisma.productUnitConversion.findMany({
      where: { productId },
      orderBy: [{ unitId: "asc" }, { id: "asc" }],
    });
    return conversions.map((conversion) => this.mapProductUnitConversion(conversion));
  }

  async createProductSupplyRelationship(
    input: CreateProductSupplyRelationshipInput,
  ): Promise<CreateProductSupplyRelationshipResult> {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, input.productId);
      if (product === null) return "PRODUCT_NOT_FOUND";

      const supplier = await this.lockSupplier(tx, input.supplierId);
      if (supplier === null) return "SUPPLIER_NOT_FOUND";

      if (!this.isActiveMaster(product) || !this.isActiveMaster(supplier)) return "CONFLICT";

      const existing = await tx.productSupplyRelationship.findUnique({
        where: { productId_supplierId: { productId: input.productId, supplierId: input.supplierId } },
        select: { id: true },
      });
      if (existing !== null) return "CONFLICT";

      const created = await tx.productSupplyRelationship.create({
        data: { productId: input.productId, supplierId: input.supplierId },
        include: { product: true, supplier: true },
      });
      return this.mapProductSupplyRelationship(created);
    });
  }

  async getProductSupplyRelationship(id: string): Promise<ProductSupplyRelationshipView | null> {
    const relationship = await this.prisma.productSupplyRelationship.findUnique({
      where: { id },
      include: { product: true, supplier: true },
    });
    return relationship === null ? null : this.mapProductSupplyRelationship(relationship);
  }

  async listProductSupplyRelationships(query: ListQuery): Promise<ProductSupplyRelationshipView[]> {
    const relationships = await this.prisma.productSupplyRelationship.findMany({
      include: { product: true, supplier: true },
      orderBy: [{ productId: "asc" }, { supplierId: "asc" }, { id: "asc" }],
      take: query.limit,
      skip: query.offset,
    });
    return relationships.map((relationship) => this.mapProductSupplyRelationship(relationship));
  }

  async updateProductSupplyRelationship(
    id: string,
    input: UpdateProductSupplyRelationshipInput,
  ): Promise<ProductSupplyRelationshipView | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      // This unguarded read discovers the immutable parent IDs only. Every
      // mutation lock is acquired afterwards in Product → Supplier →
      // relationship order.
      const identity = await tx.productSupplyRelationship.findUnique({
        where: { id },
        select: { productId: true, supplierId: true },
      });
      if (identity === null) return "NOT_FOUND";

      const product = await this.lockProduct(tx, identity.productId);
      const supplier = await this.lockSupplier(tx, identity.supplierId);
      if (product === null || supplier === null) return "CONFLICT";

      const current = await this.lockProductSupplyRelationship(tx, id);
      if (current === null) return "NOT_FOUND";
      if (current.version !== input.expectedVersion) return "CONFLICT";

      // Enabling is the only transition that can make a pair active. Closing
      // a relationship remains available even after either master is inactive.
      if (input.status === "ACTIVE" && (!this.isActiveMaster(product) || !this.isActiveMaster(supplier))) {
        return "CONFLICT";
      }

      const updated = await tx.productSupplyRelationship.update({
        where: { id: current.id },
        data: { status: input.status, version: { increment: 1 } },
        include: { product: true, supplier: true },
      });
      return this.mapProductSupplyRelationship(updated);
    });
  }

  private async ensureUnitExists(unitId: string): Promise<void> {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (unit === null) {
      throw new MasterValidationError(`Unit ${unitId} was not found.`);
    }
  }

  private async lockProduct(tx: Prisma.TransactionClient, productId: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id", "status", "deletedAt"
      FROM "Product"
      WHERE "id" = ${productId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockSupplier(tx: Prisma.TransactionClient, supplierId: string): Promise<LockedMasterRow | null> {
    const rows = await tx.$queryRaw<LockedMasterRow[]>(Prisma.sql`
      SELECT "id", "status", "deletedAt"
      FROM "Supplier"
      WHERE "id" = ${supplierId}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private async lockProductSupplyRelationship(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LockedProductSupplyRelationshipRow | null> {
    const rows = await tx.$queryRaw<LockedProductSupplyRelationshipRow[]>(Prisma.sql`
      SELECT "id", "productId", "supplierId", "status", "version"
      FROM "ProductSupplyRelationship"
      WHERE "id" = ${id}
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private isActiveMaster(value: LockedMasterRow): boolean {
    return value.status === "ACTIVE" && value.deletedAt === null;
  }

  private mapProduct(product: ProductRow): ProductView {
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      description: product.description,
      baseUnitId: product.baseUnitId,
      inventoryUnitId: product.inventoryUnitId,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      deletedAt: product.deletedAt,
    };
  }

  private mapUnit(unit: UnitRow): UnitView {
    return {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      symbol: unit.symbol,
      dimension: unit.dimension,
      status: unit.status,
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
    };
  }

  private mapSupplier(supplier: SupplierRow): SupplierView {
    return {
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      status: supplier.status,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
      deletedAt: supplier.deletedAt,
    };
  }

  private mapProductUnitConversion(conversion: ProductUnitConversionRow): ProductUnitConversionView {
    return {
      id: conversion.id,
      productId: conversion.productId,
      unitId: conversion.unitId,
      factorToBaseUnit: conversion.factorToBaseUnit.toString(),
      status: conversion.status,
      createdAt: conversion.createdAt,
      updatedAt: conversion.updatedAt,
    };
  }

  private parseDecimal(value: string, field: string): Prisma.Decimal {
    try {
      return new Prisma.Decimal(value);
    } catch {
      throw new MasterRequestError(`Invalid decimal value for ${field}.`);
    }
  }

  private mapProductSupplyRelationship(value: {
    id: string;
    productId: string;
    supplierId: string;
    status: ProductSupplyRelationshipStatus;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    product: { id: string; code: string; name: string; status: MasterStatus; deletedAt: Date | null };
    supplier: { id: string; code: string; name: string; status: MasterStatus; deletedAt: Date | null };
  }): ProductSupplyRelationshipView {
    return {
      id: value.id,
      productId: value.productId,
      supplierId: value.supplierId,
      status: value.status,
      version: value.version,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      product: {
        id: value.product.id,
        code: value.product.code,
        name: value.product.name,
        status: value.product.status,
        isDeleted: value.product.deletedAt !== null,
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
}
