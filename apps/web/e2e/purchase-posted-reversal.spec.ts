import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  openPurchaseReversalE2EFixture,
  storageStatePath,
  type PostedPurchaseFixture,
  type PurchaseReversalE2EFixture,
} from "./support/purchase-reversal-fixture";

let fixture: PurchaseReversalE2EFixture;

test.beforeAll(async () => {
  fixture = await openPurchaseReversalE2EFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

function forwardedFor(testInfo: TestInfo): string {
  const scenario = testInfo.title.slice(0, 1);
  const offset = "ABCDEFG".indexOf(scenario);
  if (offset < 0) throw new Error(`Unexpected browser E2E scenario title: ${testInfo.title}`);
  return `198.18.0.${10 + offset}`;
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": forwardedFor(testInfo) });
});

function reversalUrl(purchaseId: string): RegExp {
  return new RegExp(`/api/v1/purchases/${purchaseId}/reversals$`);
}

function previewUrl(purchaseId: string): RegExp {
  return new RegExp(`/api/v1/purchases/${purchaseId}/reversal-preview$`);
}

function auditUrl(purchaseId: string): RegExp {
  return new RegExp(`/api/v1/purchases/${purchaseId}/reversal$`);
}

async function openPurchase(page: Page, purchase: PostedPurchaseFixture): Promise<void> {
  await page.goto(`/purchases/${purchase.purchaseId}`);
  await expect(page.getByRole("heading", { name: "仕入詳細" })).toBeVisible();
}

async function openPreview(page: Page, purchase: PostedPurchaseFixture) {
  const response = page.waitForResponse((candidate) => candidate.request().method() === "GET" && previewUrl(purchase.purchaseId).test(candidate.url()));
  await page.getByRole("button", { name: "仕入補正を確認" }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "仕入補正を確認" })).toBeVisible();
}

async function fillExecutableReversal(page: Page, purchase: PostedPurchaseFixture, reason: string): Promise<void> {
  await page.locator("#purchase-reversal-reason").fill(reason);
  await page.locator(`#purchase-reversal-price-${purchase.productId}`).fill("80.000000");
  await page.locator(`#purchase-reversal-currency-${purchase.productId}`).fill("JPY");
}

function executeButton(page: Page) {
  return page.locator("form:has(#purchase-reversal-reason) button[type=submit]");
}

test("A. LEGACY_AUTHENTICATED user cannot see the POSTED purchase reversal control", async ({ browser }) => {
  const purchase = await fixture.createPostedPurchase("permission");
  const context = await browser.newContext({ storageState: storageStatePath("legacy") });
  try {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.0.10" });
    const page = await context.newPage();
    await openPurchase(page, purchase);
    await expect(page.getByRole("button", { name: "仕入補正を確認" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("B. preview is a read-only GET and does not create a reversal", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("preview");
  await openPurchase(page, purchase);
  await expect(page.getByRole("button", { name: "仕入補正を確認" })).toBeVisible();
  expect(await fixture.reversalCount(purchase.purchaseId)).toBe(0);
  await openPreview(page, purchase);
  expect(await fixture.reversalCount(purchase.purchaseId)).toBe(0);
});

test("C. browser reversal receives 201 and reaches the terminal completed state", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("success");
  await openPurchase(page, purchase);
  await openPreview(page, purchase);
  await fillExecutableReversal(page, purchase, "browser success correction");
  const auditReadback = page.waitForResponse(async (candidate) => {
    if (candidate.request().method() !== "GET" || !auditUrl(purchase.purchaseId).test(candidate.url()) || candidate.status() !== 200) return false;
    const body = await candidate.json() as { reversal: { purchaseId: string } | null };
    return body.reversal?.purchaseId === purchase.purchaseId;
  });
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && reversalUrl(purchase.purchaseId).test(candidate.url()));
  await executeButton(page).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const body = await result.json() as { id: string; reversedAt: string };
  await expect(page.getByRole("heading", { name: "仕入補正済み" })).toBeVisible();
  await expect(page.getByText(body.id, { exact: true })).toBeVisible();
  await expect(page.getByText("記録時刻", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仕入補正を確認" })).toHaveCount(0);
  const auditResponse = await auditReadback;
  expect(auditResponse.status()).toBe(200);
  const auditBody = await auditResponse.json() as { reversal: { actorUserId: string; reason: string; items: Array<{ productId: string }>; inventoryEffects: Array<{ quantityDelta: string }>; priceEffects: Array<{ appliedUnitPrice: string; appliedCurrency: string }> } };
  expect(auditBody.reversal.reason).toBe("browser success correction");
  expect(auditBody.reversal.actorUserId).toBe(fixture.admin.id);
  const auditPanel = page.getByRole("heading", { name: "仕入補正の監査記録" }).locator("..");
  await expect(auditPanel).toBeVisible();
  await expect(auditPanel.getByText("browser success correction", { exact: true })).toBeVisible();
  await expect(auditPanel.getByText(fixture.admin.id, { exact: true })).toBeVisible();
  const auditItems = auditPanel.locator('section[aria-labelledby="purchase-reversal-audit-items-title"]');
  const auditInventory = auditPanel.locator('section[aria-labelledby="purchase-reversal-audit-inventory-title"]');
  const auditPrice = auditPanel.locator('section[aria-labelledby="purchase-reversal-audit-price-title"]');
  await expect(auditItems.getByText(auditBody.reversal.items[0]!.productId, { exact: true })).toBeVisible();
  await expect(auditInventory.getByText(auditBody.reversal.inventoryEffects[0]!.quantityDelta, { exact: true })).toBeVisible();
  await expect(auditPrice.getByText(auditBody.reversal.priceEffects[0]!.appliedUnitPrice, { exact: true })).toBeVisible();
  await expect(auditPrice.getByText(auditBody.reversal.priceEffects[0]!.appliedCurrency, { exact: true })).toBeVisible();
  expect(await fixture.reversalCount(purchase.purchaseId)).toBe(1);
});

test("D. an actual stale 409 reconciles through existingReversal without another POST", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("stale");
  await openPurchase(page, purchase);
  await openPreview(page, purchase);
  await fillExecutableReversal(page, purchase, "stale browser correction");
  const competing = await fixture.completeReversal(purchase, "competing correction");
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && reversalUrl(purchase.purchaseId).test(candidate.url()));
  await executeButton(page).click();
  expect((await response).status()).toBe(409);
  await expect(page.getByRole("heading", { name: "補正結果を確認する必要があります" })).toBeVisible();
  await expect(executeButton(page)).toHaveCount(0);
  const reconciliation = page.waitForResponse((candidate) => candidate.request().method() === "GET" && previewUrl(purchase.purchaseId).test(candidate.url()));
  await page.getByRole("button", { name: "最新の補正内容を確認" }).click();
  expect((await reconciliation).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "仕入補正済み" })).toBeVisible();
  await expect(page.getByText(competing.id, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仕入補正を確認" })).toHaveCount(0);
});

test("E. intercepted 422 retains executable preview and input values for a corrected resubmission", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("validation");
  await openPurchase(page, purchase);
  await openPreview(page, purchase);
  await fillExecutableReversal(page, purchase, "first browser reason");
  let intercepted = 0;
  await page.route(reversalUrl(purchase.purchaseId), async (route) => {
    intercepted += 1;
    if (intercepted === 1) {
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ statusCode: 422 }) });
      return;
    }
    await route.continue();
  });
  await executeButton(page).click();
  await expect(page.getByText("入力内容を確認してください。補正は記録されていません。", { exact: true })).toBeVisible();
  await expect(page.locator("#purchase-reversal-reason")).toHaveValue("first browser reason");
  await expect(page.locator(`#purchase-reversal-price-${purchase.productId}`)).toHaveValue("80.000000");
  await expect(page.locator(`#purchase-reversal-currency-${purchase.productId}`)).toHaveValue("JPY");
  await page.locator("#purchase-reversal-reason").fill("corrected browser reason");
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && reversalUrl(purchase.purchaseId).test(candidate.url()));
  await executeButton(page).click();
  expect((await response).status()).toBe(201);
  expect(intercepted).toBe(2);
  await expect(page.getByRole("heading", { name: "仕入補正済み" })).toBeVisible();
});

test("F. an aborted POST enters unknown-result and only permits current preview reconciliation", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("unknown");
  await openPurchase(page, purchase);
  await openPreview(page, purchase);
  await fillExecutableReversal(page, purchase, "unknown browser correction");
  let postCount = 0;
  await page.route(reversalUrl(purchase.purchaseId), async (route) => {
    postCount += 1;
    await route.abort("connectionrefused");
  });
  await executeButton(page).click();
  await expect(page.getByRole("heading", { name: "補正結果を確認する必要があります" })).toBeVisible();
  expect(postCount).toBe(1);
  await expect(executeButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "最新の補正内容を確認" })).toBeVisible();
});

test("G. a held POST disables the UI and prevents a second browser submission", async ({ page }) => {
  const purchase = await fixture.createPostedPurchase("double-submit");
  await openPurchase(page, purchase);
  await openPreview(page, purchase);
  await fillExecutableReversal(page, purchase, "double submit correction");
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let arrive: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => { arrive = resolve; });
  let postCount = 0;
  await page.route(reversalUrl(purchase.purchaseId), async (route) => {
    postCount += 1;
    arrive?.();
    await barrier;
    await route.continue();
  });
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && reversalUrl(purchase.purchaseId).test(candidate.url()));
  const submit = executeButton(page);
  await submit.click();
  await arrived;
  await expect(submit).toBeDisabled();
  await submit.click({ force: true });
  expect(postCount).toBe(1);
  release?.();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "仕入補正済み" })).toBeVisible();
  expect(await fixture.reversalCount(purchase.purchaseId)).toBe(1);
});
