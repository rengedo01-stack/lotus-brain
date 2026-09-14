import type { Prisma } from "../../../generated/prisma/client";
import type { PurchaseDraftView } from "../infrastructure/purchase-draft.repository";

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

export type CreateRecommendationPurchaseDraftInput = {
  sourceRecommendationId: string;
  purchaseDate: Date;
};

export type RecommendationPurchaseDraftHandoffResult = {
  replayed: boolean;
  purchase: PurchaseDraftView;
};

/**
 * Read-only lineage projection. Every source value comes from the immutable
 * C21A handoff record; it is never reconstructed from mutable preferences,
 * packages, or commercial terms.
 */
export type RecommendationPurchaseHandoffLineage = {
  sourceRecommendationId: string;
  createdAt: Date;
  purchase: {
    id: string;
    status: "DRAFT" | "CONFIRMED" | "POSTED" | "CANCELLED";
    purchaseDate: Date;
  };
  purchaseItem: { id: string };
  source: {
    relationshipId: string;
    supplierId: string;
    recommendedQuantity: string;
    package: {
      id: string;
      code: string;
      quantity: string;
      version: number;
    } | null;
    commercialTerms: {
      id: string;
      version: number;
      unitPrice: string;
      currencyCode: "JPY";
      taxRate: string;
    };
  };
};

export interface PurchaseRecommendationHandoffRepository {
  findBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffView | null>;
  getLineageBySourceRecommendationId(sourceRecommendationId: string): Promise<RecommendationPurchaseHandoffLineage | null | "NOT_FOUND">;
  createInTransaction(tx: Prisma.TransactionClient, snapshot: RecommendationPurchaseHandoffSnapshot): Promise<RecommendationPurchaseHandoffView>;
  createPurchaseDraft(input: CreateRecommendationPurchaseDraftInput): Promise<RecommendationPurchaseDraftHandoffResult | "NOT_FOUND" | "CONFLICT">;
}
