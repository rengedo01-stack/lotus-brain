import { Injectable } from "@nestjs/common";
import type { MasterStatus, UnitDimension } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MasterValidationError } from "../application/master.errors";
import {
  type ListQuery,
  type MasterRepository,
  type ProductInput,
  type ProductUpdateInput,
  type ProductView,
  type SupplierInput,
  type SupplierUpdateInput,
  type SupplierView,
  type UnitInput,
  type UnitUpdateInput,
  type UnitView,
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
        name: input.name ?? current.name,
        symbol: input.symbol ?? current.symbol,
        status: input.status ?? current.status,
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

  private async ensureUnitExists(unitId: string): Promise<void> {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (unit === null) {
      throw new MasterValidationError(`Unit ${unitId} was not found.`);
    }
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
}
