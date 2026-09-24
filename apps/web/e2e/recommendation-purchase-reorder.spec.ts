import { expect, test } from "@playwright/test";
import { openRecommendationPurchaseReorderFixture, type RecommendationPurchaseReorderFixture } from "./support/recommendation-purchase-reorder-fixture";

let fixture: RecommendationPurchaseReorderFixture;

test.beforeAll(async () => {
  fixture = await openRecommendationPurchaseReorderFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

test("C26. a reversed Purchase is re-ordered only through a new Recommendation and a new handoff", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.2.10" });
  const original = await fixture.createReversedRecommendation("journey");
  const auditRead = page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith(`/api/v1/purchases/${original.purchaseAId}/reversal`));
  await page.goto(`/inventory/${original.productId}/replenishment-recommendation`);
  await expect(page.getByRole("heading", { name: "補充recommendation" })).toBeVisible();
  await expect(page.getByText("Purchase状態", { exact: true })).toBeVisible();
  expect((await auditRead).status()).toBe(200);
  await expect(page.getByText("元Purchaseは補正済みです。再発注するには、現在条件で新しいRecommendationを作成してください。", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Purchase下書きを作成" })).not.toBeVisible();

  const recalculation = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/v1/inventory/${original.productId}/replenishment-recommendation`));
  await page.getByRole("button", { name: "現在の条件で再計算" }).click();
  expect((await recalculation).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Purchase下書きを作成" })).toBeVisible();

  const recommendationBId = await fixture.activeRecommendationId(original.productId);
  expect(recommendationBId).not.toBe(original.recommendationAId);
  await page.locator("#recommendation-purchase-date").fill("2026-09-25T00:00:00.000Z");
  const redirected = page.waitForURL(/\/purchases\/[^/]+$/);
  await page.getByRole("button", { name: "Purchase下書きを作成" }).click();
  await redirected;
  await expect(page.getByRole("heading", { name: "仕入詳細" })).toBeVisible();
  const purchaseBId = new URL(page.url()).pathname.split("/").at(-1);
  expect(purchaseBId).toBeDefined();
  expect(purchaseBId).not.toBe(original.purchaseAId);
  expect(await fixture.handoffPurchaseId(original.recommendationAId)).toBe(original.purchaseAId);
  expect(await fixture.handoffPurchaseId(recommendationBId)).toBe(purchaseBId);
  await expect(fixture.readAudit(original.purchaseAId)).resolves.toEqual(original.audit);
});
