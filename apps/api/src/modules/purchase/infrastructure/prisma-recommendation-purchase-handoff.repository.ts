import { Injectable } from "@nestjs/common";
import { Prisma, type MasterStatus } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { rawTargetGap, solveReplenishmentQuantity } from "../../inventory/domain/replenishment-quantity-solver";
import type {
  CreateRecommendationPurchaseDraftInput,
  PurchaseRecommendationHandoffRepository,
  RecommendationPurchaseDraftHandoffResult,
  RecommendationPurchaseHandoffLineage,
  PurchaseRecommendationHandoffLineage,
  RecommendationPurchaseHandoffSnapshot,
  RecommendationPurchaseHandoffView,
} from "../application/recommendation-purchase-handoff.repository";
import type { PurchaseDraftView } from "./purchase-draft.repository";

const purchaseInclude = {
  supplier: true,
  items: { orderBy: { lineNumber: "asc" } },
} satisfies Prisma.PurchaseInclude;

const productInclude = {
  inventoryUnit: true,
  inventory: true,
  replenishmentPolicy: true,
  supplyPreference: {
    include: {
      relationship: {
        include: {
          supplier: true,
          orderingTerms: true,
          commercialTerms: true,
          packagePreference: { include: { package: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

type HandoffRow = Prisma.RecommendationPurchaseHandoffGetPayload<Record<string, never>>;
type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;
type ProductWithHandoffInputs = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
const handoffLineageInclude = {
  purchaseItem: { include: { purchase: true } },
} satisfies Prisma.RecommendationPurchaseHandoffInclude;
type HandoffLineageRow = Prisma.RecommendationPurchaseHandoffGetPayload<{ include: typeof handoffLineageInclude }>;
const purchaseHandoffLineageInclude = {
  purchaseItem: { select: { id: true, lineNumber: true } },
} satisfies Prisma.RecommendationPurchaseHandoffInclude;
type PurchaseHandoffLineageRow = Prisma.RecommendationPurchaseHandoffGetPayload<{ include: typeof purchaseHandoffLineageInclude }>;

@Injectable()
export class PrismaPurchaseRecommendationHandoffRepository implements PurchaseRecommendationHandoffRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffView | null> {
    const row = await this.prisma.recommendationPurchaseHandoff.findUnique({ where: { sourceRecommendationId } });
    return row === null ? null : this.toView(row);
  }

  async getLineageBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffLineage | null | "NOT_FOUND"> {
    const handoff = await this.prisma.recommendationPurchaseHandoff.findUnique({
      where: { sourceRecommendationId },
      include: handoffLineageInclude,
    });
    if (handoff !== null) return this.toLineage(handoff);

    // A missing handoff is meaningful only for an existing Recommendation.
    // Do not let the Web infer existence by replaying the write endpoint.
    const recommendation = await this.prisma.replenishmentRecommendation.findUnique({
      where: { id: sourceRecommendationId },
      select: { id: true },
    });
    return recommendation === null ? "NOT_FOUND" : null;
  }

  async getLineagesByPurchaseId(purchaseId: string): Promise<PurchaseRecommendationHandoffLineage[] | "NOT_FOUND"> {
    const purchase = await this.prisma.purchase.findUnique({ where: { id: purchaseId }, select: { id: true } });
    if (purchase === null) return "NOT_FOUND";

    const rows = await this.prisma.recommendationPurchaseHandoff.findMany({
      where: { purchaseItem: { purchaseId } },
      include: purchaseHandoffLineageInclude,
      orderBy: [{ purchaseItem: { lineNumber: "asc" } }, { purchaseItemId: "asc" }],
    });
    return rows.map((row) => this.toPurchaseLineage(row));
  }

  async createInTransaction(tx: Prisma.TransactionClient, snapshot: RecommendationPurchaseHandoffSnapshot): Promise<RecommendationPurchaseHandoffView> {
    const row = await tx.recommendationPurchaseHandoff.create({
      data: {
        ...snapshot,
        sourceRecommendedQuantity: new Prisma.Decimal(snapshot.sourceRecommendedQuantity),
        sourcePackageQuantity: snapshot.sourcePackageQuantity === null ? null : new Prisma.Decimal(snapshot.sourcePackageQuantity),
        sourceUnitPrice: new Prisma.Decimal(snapshot.sourceUnitPrice),
        sourceTaxRate: new Prisma.Decimal(snapshot.sourceTaxRate),
      },
    });
    return this.toView(row);
  }

  async createPurchaseDraft(input: CreateRecommendationPurchaseDraftInput): Promise<RecommendationPurchaseDraftHandoffResult | "NOT_FOUND" | "CONFLICT"> {
    const existing = await this.replay(input.sourceRecommendationId);
    if (existing !== null) return existing;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => this.createPurchaseDraftInTransaction(tx, input), {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
      } catch (error: unknown) {
        const replay = await this.replay(input.sourceRecommendationId);
        if (replay !== null) return replay;
        if (attempt === 2 || !this.isRetriable(error)) throw error;
      }
    }
    throw new Error("Unreachable handoff retry state.");
  }

  private async createPurchaseDraftInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateRecommendationPurchaseDraftInput,
  ): Promise<RecommendationPurchaseDraftHandoffResult | "NOT_FOUND" | "CONFLICT"> {
    const recommendation = await tx.replenishmentRecommendation.findUnique({
      where: { id: input.sourceRecommendationId },
    });
    if (recommendation === null) return "NOT_FOUND";

    if (!(await this.lockProduct(tx, recommendation.productId))) return "NOT_FOUND";
    const lockedProduct = await tx.product.findUnique({ where: { id: recommendation.productId }, select: { inventoryUnitId: true } });
    if (lockedProduct === null) return "NOT_FOUND";
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Unit" WHERE "id"=${lockedProduct.inventoryUnitId} FOR UPDATE`);
    const replay = await this.replayInTransaction(tx, input.sourceRecommendationId);
    if (replay !== null) return replay;
    if (!(await this.lockRecommendation(tx, recommendation.id))) return "NOT_FOUND";
    await this.lockSelectedSupplyInput(tx, recommendation.productId);

    const product = await tx.product.findUnique({ where: { id: recommendation.productId }, include: productInclude });
    if (product === null) return "NOT_FOUND";
    if (!this.isEligibleCurrentRecommendation(recommendation, product)) return "CONFLICT";

    const relationship = product.supplyPreference?.relationship;
    const terms = relationship?.commercialTerms;
    if (relationship === undefined || terms === null || terms === undefined || terms.currencyCode !== "JPY") return "CONFLICT";

    const quantity = recommendation.feasibleQuantitySnapshot;
    const lineAmount = quantity.mul(terms.unitPrice);
    const tax = lineAmount.mul(terms.taxRate);
    const purchase = await tx.purchase.create({
      data: {
        supplierId: relationship.supplierId,
        purchaseDate: input.purchaseDate,
        currency: terms.currencyCode,
        subtotal: lineAmount,
        tax,
        total: lineAmount.add(tax),
        status: "DRAFT",
        items: {
          create: {
            productId: product.id,
            unitId: product.inventoryUnitId,
            lineNumber: 1,
            quantity,
            unitPrice: terms.unitPrice,
            taxRate: terms.taxRate,
            lineAmount,
          },
        },
      },
      include: purchaseInclude,
    });
    const item = purchase.items[0];
    if (item === undefined) throw new Error("Handoff purchase did not create an item.");

    await this.createInTransaction(tx, {
      sourceRecommendationId: recommendation.id,
      purchaseItemId: item.id,
      sourceRelationshipId: relationship.id,
      sourceSupplierId: relationship.supplierId,
      sourceRecommendedQuantity: this.decimal(quantity),
      sourceRecommendationVersion: recommendation.version,
      sourceCalculationPolicyVersion: recommendation.calculationPolicyVersion,
      sourcePackageId: recommendation.packageIdSnapshot,
      sourcePackageCode: recommendation.packageCodeSnapshot,
      sourcePackageQuantity: recommendation.packageQuantitySnapshot === null ? null : this.decimal(recommendation.packageQuantitySnapshot),
      sourcePackageVersion: recommendation.packageVersionSnapshot,
      sourceCommercialTermsId: terms.id,
      sourceCommercialTermsVersion: terms.version,
      sourceUnitPrice: terms.unitPrice.toFixed(6),
      sourceCurrencyCode: "JPY",
      sourceTaxRate: terms.taxRate.toFixed(4),
    });
    return { replayed: false, purchase: this.purchaseView(purchase) };
  }

  private isEligibleCurrentRecommendation(
    recommendation: Prisma.ReplenishmentRecommendationGetPayload<Record<string, never>>,
    product: ProductWithHandoffInputs,
  ): boolean {
    const inventory = product.inventory;
    const policy = product.replenishmentPolicy;
    const preference = product.supplyPreference;
    const relationship = preference?.relationship;
    if (inventory === null || policy === null || preference === null || relationship === null || relationship === undefined) return false;
    if (
      recommendation.disposition !== "ACTIVE"
      || !this.isActive(product.status, product.deletedAt)
      || relationship.productId !== product.id
      || relationship.status !== "ACTIVE"
      || !this.isActive(relationship.supplier.status, relationship.supplier.deletedAt)
      || inventory.quantity.isNegative()
      || !inventory.quantity.lessThanOrEqualTo(policy.reorderPointQuantity)
      || policy.targetStockQuantity === null
      || product.inventoryUnit.code !== recommendation.inventoryUnitCodeSnapshot
      || product.inventoryUnit.name !== recommendation.inventoryUnitNameSnapshot
      || product.inventoryUnit.symbol !== recommendation.inventoryUnitSymbolSnapshot
      || recommendation.inventoryVersionSnapshot !== inventory.version
      || recommendation.replenishmentPolicyIdSnapshot !== policy.id
      || recommendation.replenishmentPolicyVersionSnapshot !== policy.version
      || recommendation.supplierPreferenceIdSnapshot !== preference.id
      || recommendation.supplierPreferenceVersionSnapshot !== preference.version
      || recommendation.relationshipIdSnapshot !== relationship.id
      || recommendation.relationshipVersionSnapshot !== relationship.version
    ) return false;

    const terms = relationship.orderingTerms;
    if (
      recommendation.orderingTermsIdSnapshot !== (terms?.id ?? null)
      || recommendation.orderingTermsVersionSnapshot !== (terms?.version ?? null)
    ) return false;

    const packagePreference = relationship.packagePreference;
    const pack = packagePreference?.package;
    if (packagePreference !== null && packagePreference !== undefined && (
      pack === null || pack === undefined
      || pack.relationshipId !== relationship.id
      || pack.status !== "ACTIVE"
      || !pack.isOrderable
    )) return false;
    if (
      recommendation.packagePreferenceIdSnapshot !== (packagePreference?.id ?? null)
      || recommendation.packagePreferenceVersionSnapshot !== (packagePreference?.version ?? null)
      || recommendation.packageIdSnapshot !== (pack?.id ?? null)
      || recommendation.packageVersionSnapshot !== (pack?.version ?? null)
    ) return false;

    const gap = rawTargetGap(this.decimal(policy.targetStockQuantity), this.decimal(inventory.quantity));
    if (gap === "0") return false;
    const solved = solveReplenishmentQuantity({
      rawTargetGap: gap,
      minimumOrderQuantity: terms?.minimumOrderQuantity === null || terms === null || terms === undefined ? null : this.decimal(terms.minimumOrderQuantity),
      orderMultipleQuantity: terms?.orderMultipleQuantity === null || terms === null || terms === undefined ? null : this.decimal(terms.orderMultipleQuantity),
      packageSize: pack === null || pack === undefined ? null : this.decimal(pack.inventoryQuantityPerPackage),
    });
    return solved.status === "READY" && new Prisma.Decimal(solved.feasibleQuantity).equals(recommendation.feasibleQuantitySnapshot);
  }

  private async replay(sourceRecommendationId: string): Promise<RecommendationPurchaseDraftHandoffResult | null> {
    const row = await this.prisma.recommendationPurchaseHandoff.findUnique({
      where: { sourceRecommendationId },
      include: { purchaseItem: { include: { purchase: { include: purchaseInclude } } } },
    });
    return row === null ? null : { replayed: true, purchase: this.purchaseView(row.purchaseItem.purchase) };
  }

  private async replayInTransaction(tx: Prisma.TransactionClient, sourceRecommendationId: string): Promise<RecommendationPurchaseDraftHandoffResult | null> {
    const row = await tx.recommendationPurchaseHandoff.findUnique({
      where: { sourceRecommendationId },
      include: { purchaseItem: { include: { purchase: { include: purchaseInclude } } } },
    });
    return row === null ? null : { replayed: true, purchase: this.purchaseView(row.purchaseItem.purchase) };
  }

  private async lockSelectedSupplyInput(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const preference = await tx.productSupplyPreference.findUnique({ where: { productId }, select: { relationshipId: true } });
    if (preference === null) return;
    const relationship = await tx.productSupplyRelationship.findUnique({ where: { id: preference.relationshipId }, select: { id: true, supplierId: true } });
    if (relationship === null) return;
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Supplier" WHERE "id"=${relationship.supplierId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProductSupplyRelationship" WHERE "id"=${relationship.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ProductSupplierCommercialTerms" WHERE "relationshipId"=${relationship.id} FOR UPDATE`);
  }

  private async lockProduct(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Product" WHERE "id"=${id} FOR UPDATE`);
    return rows.length === 1;
  }

  private async lockRecommendation(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "ReplenishmentRecommendation" WHERE "id"=${id} FOR UPDATE`);
    return rows.length === 1;
  }

  private isRetriable(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = (error as { code?: unknown }).code;
    return code === "P2002" || code === "P2034" || code === "40001";
  }

  private isActive(status: MasterStatus, deletedAt: Date | null): boolean { return status === "ACTIVE" && deletedAt === null; }
  private decimal(value: Prisma.Decimal): string { return value.toFixed(9); }

  private purchaseView(purchase: PurchaseRow): PurchaseDraftView {
    return {
      id: purchase.id,
      supplier: { id: purchase.supplier.id, code: purchase.supplier.code, name: purchase.supplier.name },
      status: purchase.status,
      purchaseDate: purchase.purchaseDate,
      documentNumber: purchase.documentNumber,
      note: purchase.note,
      subtotal: purchase.subtotal.toString(),
      tax: purchase.tax.toString(),
      total: purchase.total.toString(),
      postedAt: purchase.postedAt,
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
      items: purchase.items.map((item) => ({
        id: item.id,
        lineNumber: item.lineNumber,
        productId: item.productId,
        unitId: item.unitId,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        taxRate: item.taxRate.toString(),
        lineAmount: item.lineAmount.toString(),
      })),
    };
  }

  private toView(row: HandoffRow): RecommendationPurchaseHandoffView {
    return {
      id: row.id,
      sourceRecommendationId: row.sourceRecommendationId,
      purchaseItemId: row.purchaseItemId,
      sourceRelationshipId: row.sourceRelationshipId,
      sourceSupplierId: row.sourceSupplierId,
      sourceRecommendedQuantity: row.sourceRecommendedQuantity.toFixed(9),
      sourceRecommendationVersion: row.sourceRecommendationVersion,
      sourceCalculationPolicyVersion: row.sourceCalculationPolicyVersion,
      sourcePackageId: row.sourcePackageId,
      sourcePackageCode: row.sourcePackageCode,
      sourcePackageQuantity: row.sourcePackageQuantity === null ? null : row.sourcePackageQuantity.toFixed(9),
      sourcePackageVersion: row.sourcePackageVersion,
      sourceCommercialTermsId: row.sourceCommercialTermsId,
      sourceCommercialTermsVersion: row.sourceCommercialTermsVersion,
      sourceUnitPrice: row.sourceUnitPrice.toFixed(6),
      sourceCurrencyCode: "JPY",
      sourceTaxRate: row.sourceTaxRate.toFixed(4),
      createdAt: row.createdAt,
    };
  }

  private toLineage(row: HandoffLineageRow): RecommendationPurchaseHandoffLineage {
    return {
      sourceRecommendationId: row.sourceRecommendationId,
      createdAt: row.createdAt,
      purchase: {
        id: row.purchaseItem.purchase.id,
        status: row.purchaseItem.purchase.status,
        purchaseDate: row.purchaseItem.purchase.purchaseDate,
      },
      purchaseItem: { id: row.purchaseItem.id },
      source: this.toLineageSource(row),
    };
  }

  private toPurchaseLineage(row: PurchaseHandoffLineageRow): PurchaseRecommendationHandoffLineage {
    return {
      sourceRecommendationId: row.sourceRecommendationId,
      createdAt: row.createdAt,
      purchaseItemId: row.purchaseItem.id,
      lineNumber: row.purchaseItem.lineNumber,
      source: this.toLineageSource(row),
    };
  }

  private toLineageSource(row: HandoffRow): RecommendationPurchaseHandoffLineage["source"] {
    return {
      relationshipId: row.sourceRelationshipId,
      supplierId: row.sourceSupplierId,
      recommendedQuantity: row.sourceRecommendedQuantity.toFixed(9),
      package: row.sourcePackageId === null
        ? null
        : {
            id: row.sourcePackageId,
            code: row.sourcePackageCode!,
            quantity: row.sourcePackageQuantity!.toFixed(9),
            version: row.sourcePackageVersion!,
          },
      commercialTerms: {
        id: row.sourceCommercialTermsId,
        version: row.sourceCommercialTermsVersion,
        unitPrice: row.sourceUnitPrice.toFixed(6),
        currencyCode: "JPY",
        taxRate: row.sourceTaxRate.toFixed(4),
      },
    };
  }
}
