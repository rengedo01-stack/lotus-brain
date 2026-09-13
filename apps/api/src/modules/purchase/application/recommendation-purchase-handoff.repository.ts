import type { Prisma } from "../../../generated/prisma/client";

export const PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY = Symbol("PURCHASE_RECOMMENDATION_HANDOFF_REPOSITORY");

// The immutable values C21B must write atomically with the Purchase and
// PurchaseItem. Keeping this foundation separate avoids changing manual draft
// creation semantics before the handoff use case exists.
export type RecommendationPurchaseHandoffSnapshot = {
  sourceRecommendationId: string;
  purchaseItemId: string;
  sourceRelationshipId: string;
  sourceSupplierId: string;
  sourceRecommendedQuantity: string;
  sourceRecommendationVersion: number;
  sourceCalculationPolicyVersion: number;
  sourcePackageId: string | null;
  sourcePackageCode: string | null;
  sourcePackageQuantity: string | null;
  sourcePackageVersion: number | null;
  sourceCommercialTermsId: string;
  sourceCommercialTermsVersion: number;
  sourceUnitPrice: string;
  sourceCurrencyCode: "JPY";
  sourceTaxRate: string;
};

export type RecommendationPurchaseHandoffView = RecommendationPurchaseHandoffSnapshot & {
  id: string;
  createdAt: Date;
};

export interface PurchaseRecommendationHandoffRepository {
  findBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffView | null>;
  createInTransaction(tx: Prisma.TransactionClient, snapshot: RecommendationPurchaseHandoffSnapshot): Promise<RecommendationPurchaseHandoffView>;
}
