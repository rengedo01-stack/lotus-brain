export const REPLENISHMENT_RECOMMENDATION_REPOSITORY = Symbol("REPLENISHMENT_RECOMMENDATION_REPOSITORY");

export type ReplenishmentRecommendationDisposition = "ACTIVE" | "SUPERSEDED" | "DISMISSED";
export type ReplenishmentRecommendationFreshness = "CURRENT" | "STALE" | "INVALID";

export type ReplenishmentRecommendationView = {
  id: string;
  disposition: ReplenishmentRecommendationDisposition;
  version: number;
  calculationPolicyVersion: number;
  createdAt: Date;
  supersededAt: Date | null;
  dismissedAt: Date | null;
  freshness: ReplenishmentRecommendationFreshness;
  product: { id: string; code: string; name: string };
  inventoryUnit: { code: string; name: string; symbol: string };
  snapshot: {
    currentQuantity: string;
    inventoryVersion: number;
    reorderPointQuantity: string;
    targetStockQuantity: string;
    replenishmentPolicyVersion: number;
    draftPurchaseQuantity: string;
    confirmedPurchaseQuantity: string;
    preferredSupplier: {
      relationshipId: string;
      relationshipVersion: number;
      preferenceVersion: number;
      supplier: { id: string; code: string; name: string };
    };
    orderingTerms: { minimumOrderQuantity: string | null; orderMultipleQuantity: string | null; version: number } | null;
    preferredPackage: {
      id: string;
      code: string;
      name: string;
      inventoryQuantityPerPackage: string;
      version: number;
      preferenceVersion: number;
    } | null;
    result: { rawTargetGap: string; feasibleQuantity: string; overOrderQuantity: string; packageCount: string | null };
  };
};

export interface ReplenishmentRecommendationRepository {
  getActive(productId: string): Promise<ReplenishmentRecommendationView | null>;
  recalculate(productId: string, actorUserId: string): Promise<ReplenishmentRecommendationView | "NOT_FOUND" | "NOT_READY">;
  dismiss(productId: string, recommendationId: string, expectedVersion: number, actorUserId: string): Promise<ReplenishmentRecommendationView | "NOT_FOUND" | "CONFLICT">;
}
