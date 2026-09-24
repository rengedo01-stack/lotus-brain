import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRecommendationPurchaseHandoffOutcome,
  recommendationPurchaseHandoffOutcomeMessage,
} from "../lib/recommendation-purchase-handoff-outcome.ts";
import type { PurchaseReversalAudit } from "../lib/purchases.ts";

const reversal: PurchaseReversalAudit = {
  id: "reversal-1",
  purchaseId: "purchase-1",
  actorUserId: "actor-1",
  reason: "correction",
  reversedAt: "2026-09-24T00:00:00.000Z",
  items: [],
  inventoryEffects: [],
  priceEffects: [],
};

test("recommendation handoff outcomes distinguish lifecycle state from posted reversal authority", () => {
  const draft = classifyRecommendationPurchaseHandoffOutcome("DRAFT", undefined);
  const confirmed = classifyRecommendationPurchaseHandoffOutcome("CONFIRMED", undefined);
  const cancelled = classifyRecommendationPurchaseHandoffOutcome("CANCELLED", undefined);
  const postedUnreversed = classifyRecommendationPurchaseHandoffOutcome("POSTED", null);
  const postedReversed = classifyRecommendationPurchaseHandoffOutcome("POSTED", reversal);
  const postedUnknown = classifyRecommendationPurchaseHandoffOutcome("POSTED", undefined);

  assert.deepEqual(draft, { kind: "DRAFT" });
  assert.deepEqual(confirmed, { kind: "CONFIRMED" });
  assert.deepEqual(cancelled, { kind: "CANCELLED" });
  assert.deepEqual(postedUnreversed, { kind: "POSTED_UNREVERSED" });
  assert.deepEqual(postedReversed, {
    kind: "POSTED_REVERSED", reversalId: "reversal-1", reversedAt: "2026-09-24T00:00:00.000Z",
  });
  assert.deepEqual(postedUnknown, { kind: "POSTED_REVERSAL_UNKNOWN" });

  assert.match(recommendationPurchaseHandoffOutcomeMessage(draft), /Purchase下書き/);
  assert.doesNotMatch(recommendationPurchaseHandoffOutcomeMessage(confirmed), /Purchase下書き/);
  assert.match(recommendationPurchaseHandoffOutcomeMessage(cancelled), /元Purchaseは取消済み/);
  assert.doesNotMatch(recommendationPurchaseHandoffOutcomeMessage(cancelled), /Purchase下書き/);
  assert.match(recommendationPurchaseHandoffOutcomeMessage(postedUnreversed), /補正記録はありません/);
  assert.match(recommendationPurchaseHandoffOutcomeMessage(postedReversed), /元Purchaseは補正済み/);
  assert.doesNotMatch(recommendationPurchaseHandoffOutcomeMessage(postedReversed), /補正記録はありません/);
  assert.match(recommendationPurchaseHandoffOutcomeMessage(postedUnknown), /補正状態を確認できません/);
});
