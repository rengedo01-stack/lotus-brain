import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  PackagePreferenceRelationship, ProductSupplierPackagePreferenceContext, ProductSupplyPreferenceContext,
  ProductSupplyPreferenceRepository, SetProductSupplierPackagePreferenceInput, SetProductSupplyPreferenceInput,
} from "../application/product-supply-preference.repository";

type LockedMaster = { id: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null };
type RelationshipIdentity = { id: string; productId: string; supplierId: string; status: "ACTIVE" | "DISABLED" };
type PackageIdentity = { id: string; relationshipId: string; status: "ACTIVE" | "DISABLED"; isOrderable: boolean };

@Injectable()
export class PrismaProductSupplyPreferenceRepository implements ProductSupplyPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProductPreference(productId: string): Promise<ProductSupplyPreferenceContext | null> { return this.readProduct(this.prisma, productId); }
  async getPackagePreference(relationshipId: string): Promise<ProductSupplierPackagePreferenceContext | null> { return this.readPackage(this.prisma, relationshipId); }

  async setProductPreference(productId: string, input: SetProductSupplyPreferenceInput): Promise<ProductSupplyPreferenceContext | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, productId); if (!product) return "NOT_FOUND";
      const identity = await tx.productSupplyRelationship.findUnique({ where: { id: input.relationshipId }, select: { id: true, productId: true, supplierId: true } });
      if (!identity) return "NOT_FOUND";
      if (identity.productId !== productId) return "CONFLICT";
      const supplier = await this.lockSupplier(tx, identity.supplierId); const relationship = await this.lockRelationship(tx, identity.id);
      if (!supplier || !relationship || !this.active(product) || !this.active(supplier) || relationship.status !== "ACTIVE") return "CONFLICT";
      const current = await tx.productSupplyPreference.findUnique({ where: { productId }, select: { id: true, version: true } });
      if ((current === null && input.expectedVersion !== null) || (current !== null && current.version !== input.expectedVersion)) return "CONFLICT";
      if (current === null) await tx.productSupplyPreference.create({ data: { productId, relationshipId: identity.id } });
      else await tx.productSupplyPreference.update({ where: { id: current.id }, data: { relationshipId: identity.id, version: { increment: 1 } } });
      return (await this.readProduct(tx, productId))!;
    });
  }

  async clearProductPreference(productId: string, expectedVersion: number): Promise<ProductSupplyPreferenceContext | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      const product = await this.lockProduct(tx, productId); if (!product) return "NOT_FOUND";
      const current = await tx.productSupplyPreference.findUnique({ where: { productId }, select: { id: true, version: true } });
      if (!current || current.version !== expectedVersion) return "CONFLICT";
      await tx.productSupplyPreference.delete({ where: { id: current.id } });
      return (await this.readProduct(tx, productId))!;
    });
  }

  async setPackagePreference(relationshipId: string, input: SetProductSupplierPackagePreferenceInput): Promise<ProductSupplierPackagePreferenceContext | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({ where: { id: relationshipId }, select: { id: true, productId: true, supplierId: true } });
      if (!identity) return "NOT_FOUND";
      const product = await this.lockProduct(tx, identity.productId); const supplier = await this.lockSupplier(tx, identity.supplierId); const relationship = await this.lockRelationship(tx, relationshipId);
      const packageValue = await tx.productSupplierPackage.findUnique({ where: { id: input.packageId }, select: { id: true, relationshipId: true } });
      if (!product || !supplier || !relationship || !packageValue) return "NOT_FOUND";
      if (packageValue.relationshipId !== relationshipId) return "CONFLICT";
      const packageRow = await this.lockPackage(tx, packageValue.id);
      if (!packageRow || !this.active(product) || !this.active(supplier) || relationship.status !== "ACTIVE" || packageRow.status !== "ACTIVE" || !packageRow.isOrderable) return "CONFLICT";
      const current = await tx.productSupplierPackagePreference.findUnique({ where: { relationshipId }, select: { id: true, version: true } });
      if ((current === null && input.expectedVersion !== null) || (current !== null && current.version !== input.expectedVersion)) return "CONFLICT";
      if (current === null) await tx.productSupplierPackagePreference.create({ data: { relationshipId, packageId: packageRow.id } });
      else await tx.productSupplierPackagePreference.update({ where: { id: current.id }, data: { packageId: packageRow.id, version: { increment: 1 } } });
      return (await this.readPackage(tx, relationshipId))!;
    });
  }

  async clearPackagePreference(relationshipId: string, expectedVersion: number): Promise<ProductSupplierPackagePreferenceContext | "NOT_FOUND" | "CONFLICT"> {
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.productSupplyRelationship.findUnique({ where: { id: relationshipId }, select: { productId: true, supplierId: true } });
      if (!identity) return "NOT_FOUND";
      await this.lockProduct(tx, identity.productId); await this.lockSupplier(tx, identity.supplierId); const relationship = await this.lockRelationship(tx, relationshipId);
      if (!relationship) return "NOT_FOUND";
      const current = await tx.productSupplierPackagePreference.findUnique({ where: { relationshipId }, select: { id: true, version: true } });
      if (!current || current.version !== expectedVersion) return "CONFLICT";
      await tx.productSupplierPackagePreference.delete({ where: { id: current.id } });
      return (await this.readPackage(tx, relationshipId))!;
    });
  }

  private async readProduct(client: PrismaService | Prisma.TransactionClient, productId: string): Promise<ProductSupplyPreferenceContext | null> {
    const product = await client.product.findUnique({ where: { id: productId }, include: { supplyPreference: { include: { relationship: { include: { supplier: true } } } } } });
    if (!product) return null;
    const p = product.supplyPreference;
    return { product: this.master(product), preference: p === null ? null : {
      id: p.id, productId: p.productId, relationshipId: p.relationshipId, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
      relationship: { id: p.relationship.id, status: p.relationship.status, supplier: this.master(p.relationship.supplier) },
      isEligible: this.active(product) && this.active(p.relationship.supplier) && p.relationship.status === "ACTIVE",
    } };
  }
  private async readPackage(client: PrismaService | Prisma.TransactionClient, relationshipId: string): Promise<ProductSupplierPackagePreferenceContext | null> {
    const relationship = await client.productSupplyRelationship.findUnique({ where: { id: relationshipId }, include: { product: true, supplier: true, packagePreference: { include: { package: true } } } });
    if (!relationship) return null;
    const p = relationship.packagePreference;
    const ref: PackagePreferenceRelationship = { id: relationship.id, status: relationship.status, product: this.master(relationship.product), supplier: this.master(relationship.supplier) };
    return { relationship: ref, preference: p === null ? null : {
      id: p.id, relationshipId: p.relationshipId, packageId: p.packageId, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
      package: { id: p.package.id, relationshipId: p.package.relationshipId, code: p.package.code, name: p.package.name, inventoryQuantityPerPackage: p.package.inventoryQuantityPerPackage.toFixed(9), isOrderable: p.package.isOrderable, status: p.package.status },
      isEligible: this.active(relationship.product) && this.active(relationship.supplier) && relationship.status === "ACTIVE" && p.package.status === "ACTIVE" && p.package.isOrderable,
    } };
  }
  private master(value: { id: string; code: string; name: string; status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null }) { return { id: value.id, code: value.code, name: value.name, status: value.status, isDeleted: value.deletedAt !== null }; }
  private active(value: LockedMaster | { status: "ACTIVE" | "INACTIVE"; deletedAt: Date | null }) { return value.status === "ACTIVE" && value.deletedAt === null; }
  private async lockProduct(tx: Prisma.TransactionClient, id: string) { const r = await tx.$queryRaw<LockedMaster[]>(Prisma.sql`SELECT "id", "status", "deletedAt" FROM "Product" WHERE "id"=${id} FOR UPDATE`); return r[0] ?? null; }
  private async lockSupplier(tx: Prisma.TransactionClient, id: string) { const r = await tx.$queryRaw<LockedMaster[]>(Prisma.sql`SELECT "id", "status", "deletedAt" FROM "Supplier" WHERE "id"=${id} FOR UPDATE`); return r[0] ?? null; }
  private async lockRelationship(tx: Prisma.TransactionClient, id: string) { const r = await tx.$queryRaw<RelationshipIdentity[]>(Prisma.sql`SELECT "id", "productId", "supplierId", "status" FROM "ProductSupplyRelationship" WHERE "id"=${id} FOR UPDATE`); return r[0] ?? null; }
  private async lockPackage(tx: Prisma.TransactionClient, id: string) { const r = await tx.$queryRaw<PackageIdentity[]>(Prisma.sql`SELECT "id", "relationshipId", "status", "isOrderable" FROM "ProductSupplierPackage" WHERE "id"=${id} FOR UPDATE`); return r[0] ?? null; }
}
