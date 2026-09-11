import { Injectable } from "@nestjs/common";
import { Prisma, type MasterStatus } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  type OrderingTermsView,
  type PreferredPackageView,
  type PreferredSupplierView,
  type ReplenishmentQuantityPreviewRepository,
  type ReplenishmentQuantityPreviewResult,
  type ReplenishmentQuantityPreviewView,
} from "../application/replenishment-quantity-preview.repository";
import { rawTargetGap, solveReplenishmentQuantity } from "../domain/replenishment-quantity-solver";

type PreviewProduct = Prisma.ProductGetPayload<{
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

@Injectable()
export class PrismaReplenishmentQuantityPreviewRepository implements ReplenishmentQuantityPreviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(productId: string): Promise<ReplenishmentQuantityPreviewView | null> {
    return this.prisma.$transaction(async (tx) => {
      // All values, including informational unposted-Purchase quantities, are
      // read from the same repeatable-read snapshot. This endpoint is fully
      // read-only, so it deliberately takes no row locks.
      const product = await tx.product.findUnique({
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
      if (product === null) return null;

      const [draft, confirmed] = product.inventory === null
        ? [null, null]
        : await Promise.all([
          tx.purchaseItem.aggregate({
            where: { productId, purchase: { is: { status: "DRAFT" } } },
            _sum: { quantity: true },
          }),
          tx.purchaseItem.aggregate({
            where: { productId, purchase: { is: { status: "CONFIRMED" } } },
            _sum: { quantity: true },
          }),
        ]);

      return this.toView(
        product,
        draft === null ? null : this.decimalOrZero(draft._sum.quantity),
        confirmed === null ? null : this.decimalOrZero(confirmed._sum.quantity),
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private toView(product: PreviewProduct, draftPurchaseQuantity: string | null, confirmedPurchaseQuantity: string | null): ReplenishmentQuantityPreviewView {
    const inventory = product.inventory;
    const policy = product.replenishmentPolicy;
    const selected = product.supplyPreference?.relationship ?? null;
    const preferredSupplier = selected === null ? null : this.supplierView(product, selected);
    const orderingTerms = selected?.orderingTerms === null || selected === null
      ? null
      : {
        minimumOrderQuantity: selected.orderingTerms.minimumOrderQuantity === null ? null : this.decimal(selected.orderingTerms.minimumOrderQuantity),
        orderMultipleQuantity: selected.orderingTerms.orderMultipleQuantity === null ? null : this.decimal(selected.orderingTerms.orderMultipleQuantity),
      } satisfies OrderingTermsView;
    const preferredPackage = selected === null ? null : this.packageView(product, selected);

    const currentQuantity = inventory === null ? null : this.decimal(inventory.quantity);
    const reorderPointQuantity = policy === null ? null : this.decimal(policy.reorderPointQuantity);
    const targetStockQuantity = policy?.targetStockQuantity === null || policy === null ? null : this.decimal(policy.targetStockQuantity);

    const result = this.resultFor({
      product,
      currentQuantity,
      reorderPointQuantity,
      targetStockQuantity,
      orderingTerms,
      preferredSupplier,
      preferredPackage,
    });

    return {
      product: { id: product.id, code: product.code, name: product.name },
      inventoryUnit: { code: product.inventoryUnit.code, name: product.inventoryUnit.name, symbol: product.inventoryUnit.symbol },
      currentQuantity,
      reorderPointQuantity,
      targetStockQuantity,
      draftPurchaseQuantity,
      confirmedPurchaseQuantity,
      preferredSupplier,
      orderingTerms,
      preferredPackage,
      result,
    };
  }

  private resultFor(input: {
    product: PreviewProduct;
    currentQuantity: string | null;
    reorderPointQuantity: string | null;
    targetStockQuantity: string | null;
    orderingTerms: OrderingTermsView | null;
    preferredSupplier: PreferredSupplierView | null;
    preferredPackage: PreferredPackageView | null;
  }): ReplenishmentQuantityPreviewResult {
    const { product, currentQuantity, reorderPointQuantity, targetStockQuantity, orderingTerms, preferredSupplier, preferredPackage } = input;
    if (
      product.status !== "ACTIVE"
      || product.deletedAt !== null
      || currentQuantity === null
      || reorderPointQuantity === null
      || !product.inventory!.quantity.lessThanOrEqualTo(product.replenishmentPolicy!.reorderPointQuantity)
    ) return this.blocked("NOT_A_REPLENISHMENT_CANDIDATE");
    if (targetStockQuantity === null) return this.blocked("TARGET_NOT_CONFIGURED");
    if (product.inventory!.quantity.isNegative()) return this.blocked("INVENTORY_RECONCILIATION_REQUIRED");

    const gap = rawTargetGap(targetStockQuantity, currentQuantity);
    if (gap === "0") return this.blocked("NO_POSITIVE_NEED", gap);
    if (preferredSupplier === null) return this.blocked("NO_PREFERRED_SUPPLIER", gap);
    if (!preferredSupplier.isEligible) return this.blocked("PREFERRED_SUPPLIER_INELIGIBLE", gap);
    if (preferredPackage !== null && !preferredPackage.isEligible) return this.blocked("PREFERRED_PACKAGE_INELIGIBLE", gap);

    const solved = solveReplenishmentQuantity({
      rawTargetGap: gap,
      minimumOrderQuantity: orderingTerms?.minimumOrderQuantity ?? null,
      orderMultipleQuantity: orderingTerms?.orderMultipleQuantity ?? null,
      packageSize: preferredPackage?.inventoryQuantityPerPackage ?? null,
    });
    if (solved.status === "READY") {
      return {
        status: "READY",
        rawTargetGap: solved.rawTargetGap,
        feasibleQuantity: solved.feasibleQuantity,
        overOrderQuantity: solved.overOrderQuantity,
        packageCount: solved.packageCount,
      };
    }
    if (solved.status === "NO_POSITIVE_NEED") return this.blocked("NO_POSITIVE_NEED", solved.rawTargetGap);
    return this.blocked("CONSTRAINT_UNREPRESENTABLE", solved.rawTargetGap);
  }

  private supplierView(product: PreviewProduct, relationship: NonNullable<PreviewProduct["supplyPreference"]>["relationship"]): PreferredSupplierView {
    return {
      relationshipId: relationship.id,
      supplier: { id: relationship.supplier.id, code: relationship.supplier.code, name: relationship.supplier.name },
      isEligible: this.masterIsActive(product.status, product.deletedAt)
        && relationship.productId === product.id
        && relationship.status === "ACTIVE"
        && this.masterIsActive(relationship.supplier.status, relationship.supplier.deletedAt),
    };
  }

  private packageView(product: PreviewProduct, relationship: NonNullable<PreviewProduct["supplyPreference"]>["relationship"]): PreferredPackageView | null {
    const preference = relationship.packagePreference;
    if (preference === null) return null;
    const packageValue = preference.package;
    return {
      id: packageValue.id,
      code: packageValue.code,
      name: packageValue.name,
      inventoryQuantityPerPackage: this.decimal(packageValue.inventoryQuantityPerPackage),
      isEligible: this.masterIsActive(product.status, product.deletedAt)
        && relationship.productId === product.id
        && relationship.status === "ACTIVE"
        && this.masterIsActive(relationship.supplier.status, relationship.supplier.deletedAt)
        && packageValue.relationshipId === relationship.id
        && packageValue.status === "ACTIVE"
        && packageValue.isOrderable,
    };
  }

  private blocked(status: Exclude<ReplenishmentQuantityPreviewResult["status"], "READY">, rawTargetGap: string | null = null): ReplenishmentQuantityPreviewResult {
    return { status, rawTargetGap, feasibleQuantity: null, overOrderQuantity: null, packageCount: null };
  }

  private masterIsActive(status: MasterStatus, deletedAt: Date | null): boolean {
    return status === "ACTIVE" && deletedAt === null;
  }

  private decimal(value: Prisma.Decimal): string {
    return value.toFixed(9);
  }

  private decimalOrZero(value: Prisma.Decimal | null): string {
    return value === null ? "0.000000000" : this.decimal(value);
  }
}
