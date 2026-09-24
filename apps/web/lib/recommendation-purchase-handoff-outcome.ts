import type { PurchaseReversalAudit, PurchaseStatus } from "./purchases.ts";

/**
 * This is a display-only classification. Handoff lineage remains the only
 * authority for the Recommendation-to-Purchase relationship, while the C25
 * audit read remains the only authority for whether a POSTED Purchase was
 * corrected.
 */
export type RecommendationPurchaseHandoffOutcome =
  | { kind: "DRAFT" }
  | { kind: "CONFIRMED" }
  | { kind: "CANCELLED" }
  | { kind: "POSTED_UNREVERSED" }
  | { kind: "POSTED_REVERSED"; reversalId: string; reversedAt: string }
  | { kind: "POSTED_REVERSAL_UNKNOWN" };

/**
 * `undefined` means that the C25 audit read was unavailable. It deliberately
 * cannot be classified as an unreversed POSTED purchase.
 */
export function classifyRecommendationPurchaseHandoffOutcome(
  purchaseStatus: PurchaseStatus,
  reversal: PurchaseReversalAudit | null | undefined,
): RecommendationPurchaseHandoffOutcome {
  if (purchaseStatus === "DRAFT") return { kind: "DRAFT" };
  if (purchaseStatus === "CONFIRMED") return { kind: "CONFIRMED" };
  if (purchaseStatus === "CANCELLED") return { kind: "CANCELLED" };
  if (reversal === undefined) return { kind: "POSTED_REVERSAL_UNKNOWN" };
  if (reversal === null) return { kind: "POSTED_UNREVERSED" };
  return { kind: "POSTED_REVERSED", reversalId: reversal.id, reversedAt: reversal.reversedAt };
}

/**
 * Keep the lifecycle wording beside its classification so the UI cannot
 * accidentally present a terminal Purchase as an eligible draft handoff.
 */
export function recommendationPurchaseHandoffOutcomeMessage(
  outcome: RecommendationPurchaseHandoffOutcome,
): string {
  switch (outcome.kind) {
    case "DRAFT":
      return "このrecommendationは、既存のPurchase下書きへ一度だけ引き渡されています。";
    case "CONFIRMED":
      return "このrecommendationに対応する既存Purchaseは確認済みです。";
    case "CANCELLED":
      return "元Purchaseは取消済みです。再発注するには、現在条件で新しいRecommendationを作成してください。";
    case "POSTED_UNREVERSED":
      return "元PurchaseはPOSTEDです。補正記録はありません。";
    case "POSTED_REVERSED":
      return "元Purchaseは補正済みです。再発注するには、現在条件で新しいRecommendationを作成してください。";
    case "POSTED_REVERSAL_UNKNOWN":
      return "Purchaseの補正状態を確認できません。";
  }
}
