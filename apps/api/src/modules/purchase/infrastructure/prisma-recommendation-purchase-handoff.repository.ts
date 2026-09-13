import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type {
  PurchaseRecommendationHandoffRepository,
  RecommendationPurchaseHandoffSnapshot,
  RecommendationPurchaseHandoffView,
} from "../application/recommendation-purchase-handoff.repository";

type HandoffRow = Prisma.RecommendationPurchaseHandoffGetPayload<Record<string, never>>;

@Injectable()
export class PrismaPurchaseRecommendationHandoffRepository implements PurchaseRecommendationHandoffRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffView | null> {
    const row = await this.prisma.recommendationPurchaseHandoff.findUnique({ where: { sourceRecommendationId } });
    return row === null ? null : this.toView(row);
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
}
