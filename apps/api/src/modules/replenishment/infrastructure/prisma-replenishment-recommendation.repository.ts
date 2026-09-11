import { Injectable } from "@nestjs/common";
import { Prisma, type MasterStatus, type ReplenishmentRecommendation } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { rawTargetGap, solveReplenishmentQuantity } from "../../inventory/domain/replenishment-quantity-solver";
import type {
  ReplenishmentRecommendationFreshness,
  ReplenishmentRecommendationRepository,
  ReplenishmentRecommendationView,
} from "../application/replenishment-recommendation.repository";

const CALCULATION_POLICY_VERSION = 1;

type ProductWithCalculationInputs = Prisma.ProductGetPayload<{
  include: {
    inventoryUnit: true;
    inventory: true;
    replenishmentPolicy: true;
    supplyPreference: {
      include: {
        relationship: {
          include: {
            supplier: true;
            orderingTerms: true;
            packagePreference: { include: { package: true } };
          };
        };
      };
    };
  };
}>;

type ReadySnapshot = {
  product: { id: string; code: string; name: string };
  inventoryUnit: { code: string; name: string; symbol: string };
  currentQuantity: string;
  inventoryVersion: number;
  reorderPointQuantity: string;
  targetStockQuantity: string;
  replenishmentPolicyId: string;
  replenishmentPolicyVersion: number;
  draftPurchaseQuantity: string;
  confirmedPurchaseQuantity: string;
  preferredSupplier: {
    preferenceId: string;
    preferenceVersion: number;
    relationshipId: string;
    relationshipVersion: number;
    supplier: { id: string; code: string; name: string };
  };
  orderingTerms: { id: string; version: number; minimumOrderQuantity: string | null; orderMultipleQuantity: string | null } | null;
  preferredPackage: { preferenceId: string; preferenceVersion: number; id: string; version: number; code: string; name: string; inventoryQuantityPerPackage: string } | null;
  result: { rawTargetGap: string; feasibleQuantity: string; overOrderQuantity: string; packageCount: string | null };
};

@Injectable()
export class PrismaReplenishmentRecommendationRepository implements ReplenishmentRecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(productId: string): Promise<ReplenishmentRecommendationView | null> {
    return this.prisma.$transaction(async (tx) => {
      const recommendation = await tx.replenishmentRecommendation.findFirst({
        where: { productId, disposition: "ACTIVE" },
      });
      if (recommendation === null) return null;
      return this.toView(recommendation, await this.freshnessFor(tx, recommendation));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async recalculate(productId: string, actorUserId: string): Promise<ReplenishmentRecommendationView | "NOT_FOUND" | "NOT_READY"> {
    return this.withSerializationRetry(() => this.prisma.$transaction(async (tx) => {
      if (!(await this.lockProduct(tx, productId))) return "NOT_FOUND";
      await this.lockSelectedSupplyInput(tx, productId);

      const product = await this.loadProduct(tx, productId);
      if (product === null) return "NOT_FOUND";
      const purchaseFacts = await this.purchaseFacts(tx, product.inventory === null ? null : product.id);
      const snapshot = this.toReadySnapshot(product, purchaseFacts);
      if (snapshot === null) return "NOT_READY";

      const active = await tx.replenishmentRecommendation.findFirst({
        where: { productId, disposition: "ACTIVE" },
        select: { id: true },
      });
      if (active !== null) {
        await tx.replenishmentRecommendation.update({
          where: { id: active.id },
          data: {
            disposition: "SUPERSEDED",
            version: { increment: 1 },
            supersededByUserId: actorUserId,
            supersededAt: new Date(),
          },
        });
      }

      const created = await tx.replenishmentRecommendation.create({ data: this.createData(snapshot, actorUserId) });
      return this.toView(created, "CURRENT");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }

  async dismiss(productId: string, recommendationId: string, expectedVersion: number, actorUserId: string): Promise<ReplenishmentRecommendationView | "NOT_FOUND" | "CONFLICT"> {
    return this.withSerializationRetry(() => this.prisma.$transaction(async (tx) => {
      if (!(await this.lockProduct(tx, productId))) return "NOT_FOUND";
      const recommendation = await this.lockRecommendation(tx, recommendationId);
      if (recommendation === null || recommendation.productId !== productId) return "NOT_FOUND";
      if (recommendation.disposition !== "ACTIVE" || recommendation.version !== expectedVersion) return "CONFLICT";
      const dismissed = await tx.replenishmentRecommendation.update({
        where: { id: recommendation.id },
        data: {
          disposition: "DISMISSED",
          version: { increment: 1 },
          dismissedByUserId: actorUserId,
          dismissedAt: new Date(),
        },
      });
      return this.toView(dismissed, await this.freshnessFor(tx, dismissed));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  }

  /**
   * PostgreSQL can abort a concurrent RepeatableRead transaction after its
   * Product lock is released. Retry only that database serialization outcome:
   * the whole transaction is rerun, so no partial lifecycle transition can be
   * observed and the Product lock still defines the ordering.
   */
  private async withSerializationRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await operation(); }
      catch (error: unknown) {
        if (attempt === 2 || !this.isSerializationConflict(error)) throw error;
      }
    }
    throw new Error("Unreachable serialization retry state.");
  }

  private isSerializationConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
      && (((error as { code?: unknown }).code === "P2034") || ((error as { code?: unknown }).code === "40001"));
  }

  private async freshnessFor(tx: Prisma.TransactionClient, recommendation: ReplenishmentRecommendation): Promise<ReplenishmentRecommendationFreshness> {
    const product = await this.loadProduct(tx, recommendation.productId);
    if (product === null) return "INVALID";
    const current = this.toReadySnapshot(product, { draftPurchaseQuantity: "0.000000000", confirmedPurchaseQuantity: "0.000000000" });
    if (current === null) return "INVALID";
    return this.sameAuthoritativeInputs(recommendation, current) ? "CURRENT" : "STALE";
  }

  private async loadProduct(client: PrismaService | Prisma.TransactionClient, productId: string): Promise<ProductWithCalculationInputs | null> {
    return client.product.findUnique({
      where: { id: productId },
      include: {
        inventoryUnit: true,
        inventory: true,
        replenishmentPolicy: true,
        supplyPreference: {
          include: {
            relationship: {
              include: {
                supplier: true,
                orderingTerms: true,
                packagePreference: { include: { package: true } },
              },
            },
          },
        },
      },
    });
  }

  private async purchaseFacts(tx: Prisma.TransactionClient, productId: string | null): Promise<{ draftPurchaseQuantity: string; confirmedPurchaseQuantity: string }> {
    if (productId === null) return { draftPurchaseQuantity: "0.000000000", confirmedPurchaseQuantity: "0.000000000" };
    const [draft, confirmed] = await Promise.all([
      tx.purchaseItem.aggregate({ where: { productId, purchase: { is: { status: "DRAFT" } } }, _sum: { quantity: true } }),
      tx.purchaseItem.aggregate({ where: { productId, purchase: { is: { status: "CONFIRMED" } } }, _sum: { quantity: true } }),
    ]);
    return {
      draftPurchaseQuantity: this.decimalOrZero(draft._sum.quantity),
      confirmedPurchaseQuantity: this.decimalOrZero(confirmed._sum.quantity),
    };
  }

  private toReadySnapshot(product: ProductWithCalculationInputs, purchaseFacts: { draftPurchaseQuantity: string; confirmedPurchaseQuantity: string }): ReadySnapshot | null {
    const inventory = product.inventory;
    const policy = product.replenishmentPolicy;
    const preference = product.supplyPreference;
    const relationship = preference?.relationship ?? null;
    if (
      !this.isActive(product.status, product.deletedAt)
      || inventory === null
      || policy === null
      || inventory.quantity.isNegative()
      || !inventory.quantity.lessThanOrEqualTo(policy.reorderPointQuantity)
      || policy.targetStockQuantity === null
      || preference === null
      || relationship === null
      || relationship.productId !== product.id
      || relationship.status !== "ACTIVE"
      || !this.isActive(relationship.supplier.status, relationship.supplier.deletedAt)
    ) return null;

    const packagePreference = relationship.packagePreference;
    const packageValue = packagePreference?.package ?? null;
    if (packagePreference !== null && (
      packageValue === null
      || packageValue.relationshipId !== relationship.id
      || packageValue.status !== "ACTIVE"
      || !packageValue.isOrderable
    )) return null;

    const currentQuantity = this.decimal(inventory.quantity);
    const targetStockQuantity = this.decimal(policy.targetStockQuantity);
    const gap = rawTargetGap(targetStockQuantity, currentQuantity);
    if (gap === "0") return null;

    const orderingTerms = relationship.orderingTerms === null ? null : {
      id: relationship.orderingTerms.id,
      version: relationship.orderingTerms.version,
      minimumOrderQuantity: relationship.orderingTerms.minimumOrderQuantity === null ? null : this.decimal(relationship.orderingTerms.minimumOrderQuantity),
      orderMultipleQuantity: relationship.orderingTerms.orderMultipleQuantity === null ? null : this.decimal(relationship.orderingTerms.orderMultipleQuantity),
    };
    const preferredPackage = packagePreference === null || packageValue === null ? null : {
      preferenceId: packagePreference.id,
      preferenceVersion: packagePreference.version,
      id: packageValue.id,
      version: packageValue.version,
      code: packageValue.code,
      name: packageValue.name,
      inventoryQuantityPerPackage: this.decimal(packageValue.inventoryQuantityPerPackage),
    };
    const solved = solveReplenishmentQuantity({
      rawTargetGap: gap,
      minimumOrderQuantity: orderingTerms?.minimumOrderQuantity ?? null,
      orderMultipleQuantity: orderingTerms?.orderMultipleQuantity ?? null,
      packageSize: preferredPackage?.inventoryQuantityPerPackage ?? null,
    });
    if (solved.status !== "READY") return null;

    return {
      product: { id: product.id, code: product.code, name: product.name },
      inventoryUnit: { code: product.inventoryUnit.code, name: product.inventoryUnit.name, symbol: product.inventoryUnit.symbol },
      currentQuantity,
      inventoryVersion: inventory.version,
      reorderPointQuantity: this.decimal(policy.reorderPointQuantity),
      targetStockQuantity,
      replenishmentPolicyId: policy.id,
      replenishmentPolicyVersion: policy.version,
      draftPurchaseQuantity: purchaseFacts.draftPurchaseQuantity,
      confirmedPurchaseQuantity: purchaseFacts.confirmedPurchaseQuantity,
      preferredSupplier: {
        preferenceId: preference.id,
        preferenceVersion: preference.version,
        relationshipId: relationship.id,
        relationshipVersion: relationship.version,
        supplier: { id: relationship.supplier.id, code: relationship.supplier.code, name: relationship.supplier.name },
      },
      orderingTerms,
      preferredPackage,
      result: {
        rawTargetGap: solved.rawTargetGap,
        feasibleQuantity: solved.feasibleQuantity,
        overOrderQuantity: solved.overOrderQuantity,
        packageCount: solved.packageCount,
      },
    };
  }

  private createData(snapshot: ReadySnapshot, actorUserId: string): Prisma.ReplenishmentRecommendationUncheckedCreateInput {
    return {
      productId: snapshot.product.id,
      calculationPolicyVersion: CALCULATION_POLICY_VERSION,
      productCodeSnapshot: snapshot.product.code,
      productNameSnapshot: snapshot.product.name,
      inventoryUnitCodeSnapshot: snapshot.inventoryUnit.code,
      inventoryUnitNameSnapshot: snapshot.inventoryUnit.name,
      inventoryUnitSymbolSnapshot: snapshot.inventoryUnit.symbol,
      inventoryQuantitySnapshot: new Prisma.Decimal(snapshot.currentQuantity),
      inventoryVersionSnapshot: snapshot.inventoryVersion,
      replenishmentPolicyIdSnapshot: snapshot.replenishmentPolicyId,
      replenishmentPolicyVersionSnapshot: snapshot.replenishmentPolicyVersion,
      reorderPointQuantitySnapshot: new Prisma.Decimal(snapshot.reorderPointQuantity),
      targetStockQuantitySnapshot: new Prisma.Decimal(snapshot.targetStockQuantity),
      supplierPreferenceIdSnapshot: snapshot.preferredSupplier.preferenceId,
      supplierPreferenceVersionSnapshot: snapshot.preferredSupplier.preferenceVersion,
      relationshipIdSnapshot: snapshot.preferredSupplier.relationshipId,
      relationshipVersionSnapshot: snapshot.preferredSupplier.relationshipVersion,
      supplierIdSnapshot: snapshot.preferredSupplier.supplier.id,
      supplierCodeSnapshot: snapshot.preferredSupplier.supplier.code,
      supplierNameSnapshot: snapshot.preferredSupplier.supplier.name,
      orderingTermsIdSnapshot: snapshot.orderingTerms?.id ?? null,
      orderingTermsVersionSnapshot: snapshot.orderingTerms?.version ?? null,
      minimumOrderQuantitySnapshot: snapshot.orderingTerms?.minimumOrderQuantity === null || snapshot.orderingTerms === null ? null : new Prisma.Decimal(snapshot.orderingTerms.minimumOrderQuantity),
      orderMultipleQuantitySnapshot: snapshot.orderingTerms?.orderMultipleQuantity === null || snapshot.orderingTerms === null ? null : new Prisma.Decimal(snapshot.orderingTerms.orderMultipleQuantity),
      packagePreferenceIdSnapshot: snapshot.preferredPackage?.preferenceId ?? null,
      packagePreferenceVersionSnapshot: snapshot.preferredPackage?.preferenceVersion ?? null,
      packageIdSnapshot: snapshot.preferredPackage?.id ?? null,
      packageVersionSnapshot: snapshot.preferredPackage?.version ?? null,
      packageCodeSnapshot: snapshot.preferredPackage?.code ?? null,
      packageNameSnapshot: snapshot.preferredPackage?.name ?? null,
      packageQuantitySnapshot: snapshot.preferredPackage === null ? null : new Prisma.Decimal(snapshot.preferredPackage.inventoryQuantityPerPackage),
      draftPurchaseQuantitySnapshot: new Prisma.Decimal(snapshot.draftPurchaseQuantity),
      confirmedPurchaseQuantitySnapshot: new Prisma.Decimal(snapshot.confirmedPurchaseQuantity),
      rawTargetGapSnapshot: new Prisma.Decimal(snapshot.result.rawTargetGap),
      feasibleQuantitySnapshot: new Prisma.Decimal(snapshot.result.feasibleQuantity),
      overOrderQuantitySnapshot: new Prisma.Decimal(snapshot.result.overOrderQuantity),
      packageCountSnapshot: snapshot.result.packageCount,
      createdByUserId: actorUserId,
    };
  }

  private toView(recommendation: ReplenishmentRecommendation, freshness: ReplenishmentRecommendationFreshness): ReplenishmentRecommendationView {
    return {
      id: recommendation.id,
      disposition: recommendation.disposition,
      version: recommendation.version,
      calculationPolicyVersion: recommendation.calculationPolicyVersion,
      createdAt: recommendation.createdAt,
      supersededAt: recommendation.supersededAt,
      dismissedAt: recommendation.dismissedAt,
      freshness,
      product: { id: recommendation.productId, code: recommendation.productCodeSnapshot, name: recommendation.productNameSnapshot },
      inventoryUnit: { code: recommendation.inventoryUnitCodeSnapshot, name: recommendation.inventoryUnitNameSnapshot, symbol: recommendation.inventoryUnitSymbolSnapshot },
      snapshot: {
        currentQuantity: this.decimal(recommendation.inventoryQuantitySnapshot),
        inventoryVersion: recommendation.inventoryVersionSnapshot,
        reorderPointQuantity: this.decimal(recommendation.reorderPointQuantitySnapshot),
        targetStockQuantity: this.decimal(recommendation.targetStockQuantitySnapshot),
        replenishmentPolicyVersion: recommendation.replenishmentPolicyVersionSnapshot,
        draftPurchaseQuantity: this.decimal(recommendation.draftPurchaseQuantitySnapshot),
        confirmedPurchaseQuantity: this.decimal(recommendation.confirmedPurchaseQuantitySnapshot),
        preferredSupplier: {
          relationshipId: recommendation.relationshipIdSnapshot,
          relationshipVersion: recommendation.relationshipVersionSnapshot,
          preferenceVersion: recommendation.supplierPreferenceVersionSnapshot,
          supplier: { id: recommendation.supplierIdSnapshot, code: recommendation.supplierCodeSnapshot, name: recommendation.supplierNameSnapshot },
        },
        orderingTerms: recommendation.orderingTermsIdSnapshot === null || recommendation.orderingTermsVersionSnapshot === null ? null : {
          minimumOrderQuantity: recommendation.minimumOrderQuantitySnapshot === null ? null : this.decimal(recommendation.minimumOrderQuantitySnapshot),
          orderMultipleQuantity: recommendation.orderMultipleQuantitySnapshot === null ? null : this.decimal(recommendation.orderMultipleQuantitySnapshot),
          version: recommendation.orderingTermsVersionSnapshot,
        },
        preferredPackage: recommendation.packageIdSnapshot === null || recommendation.packageVersionSnapshot === null || recommendation.packagePreferenceVersionSnapshot === null || recommendation.packageCodeSnapshot === null || recommendation.packageNameSnapshot === null || recommendation.packageQuantitySnapshot === null ? null : {
          id: recommendation.packageIdSnapshot,
          code: recommendation.packageCodeSnapshot,
          name: recommendation.packageNameSnapshot,
          inventoryQuantityPerPackage: this.decimal(recommendation.packageQuantitySnapshot),
          version: recommendation.packageVersionSnapshot,
          preferenceVersion: recommendation.packagePreferenceVersionSnapshot,
        },
        result: {
          rawTargetGap: this.decimal(recommendation.rawTargetGapSnapshot),
          feasibleQuantity: this.decimal(recommendation.feasibleQuantitySnapshot),
          overOrderQuantity: this.decimal(recommendation.overOrderQuantitySnapshot),
          packageCount: recommendation.packageCountSnapshot,
        },
      },
    };
  }

  private sameAuthoritativeInputs(recommendation: ReplenishmentRecommendation, current: ReadySnapshot): boolean {
    return recommendation.inventoryVersionSnapshot === current.inventoryVersion
      && recommendation.replenishmentPolicyIdSnapshot === current.replenishmentPolicyId
      && recommendation.replenishmentPolicyVersionSnapshot === current.replenishmentPolicyVersion
      && recommendation.supplierPreferenceIdSnapshot === current.preferredSupplier.preferenceId
      && recommendation.supplierPreferenceVersionSnapshot === current.preferredSupplier.preferenceVersion
      && recommendation.relationshipIdSnapshot === current.preferredSupplier.relationshipId
      && recommendation.relationshipVersionSnapshot === current.preferredSupplier.relationshipVersion
      && recommendation.orderingTermsIdSnapshot === (current.orderingTerms?.id ?? null)
      && recommendation.orderingTermsVersionSnapshot === (current.orderingTerms?.version ?? null)
      && recommendation.packagePreferenceIdSnapshot === (current.preferredPackage?.preferenceId ?? null)
      && recommendation.packagePreferenceVersionSnapshot === (current.preferredPackage?.preferenceVersion ?? null)
      && recommendation.packageIdSnapshot === (current.preferredPackage?.id ?? null)
      && recommendation.packageVersionSnapshot === (current.preferredPackage?.version ?? null);
  }

  private isActive(status: MasterStatus, deletedAt: Date | null): boolean { return status === "ACTIVE" && deletedAt === null; }
  private decimal(value: Prisma.Decimal): string { return value.toFixed(9); }
  private decimalOrZero(value: Prisma.Decimal | null): string { return value === null ? "0.000000000" : this.decimal(value); }

  private async lockSelectedSupplyInput(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const preference = await tx.productSupplyPreference.findUnique({ where: { productId }, select: { relationshipId: true } });
    if (preference === null) return;
    const relationship = await tx.productSupplyRelationship.findUnique({ where: { id: preference.relationshipId }, select: { id: true, supplierId: true } });
    if (relationship === null) return;
    await this.lockSupplier(tx, relationship.supplierId);
    await this.lockRelationship(tx, relationship.id);
  }

  private async lockProduct(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Product" WHERE "id"=${id} FOR UPDATE`);
    return rows.length === 1;
  }
  private async lockSupplier(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id"=${id} FOR UPDATE`);
  }
  private async lockRelationship(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProductSupplyRelationship" WHERE "id"=${id} FOR UPDATE`);
  }
  private async lockRecommendation(tx: Prisma.TransactionClient, id: string): Promise<ReplenishmentRecommendation | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "ReplenishmentRecommendation" WHERE "id"=${id} FOR UPDATE`);
    return rows.length === 0 ? null : tx.replenishmentRecommendation.findUnique({ where: { id } });
  }
}
