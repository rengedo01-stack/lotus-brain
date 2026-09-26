import { expect, test, type Locator, type Response } from "@playwright/test";
import {
  openRecommendationPurchaseReorderFixture,
  type ReadyReplenishmentProduct,
  type RecommendationPurchaseReorderFixture,
} from "./support/recommendation-purchase-reorder-fixture";

let fixture: RecommendationPurchaseReorderFixture;

test.beforeAll(async () => {
  fixture = await openRecommendationPurchaseReorderFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

function apiResponse(pathname: string, method: "GET" | "POST", query?: (searchParams: URLSearchParams) => boolean) {
  return (response: Response) => {
    const url = new URL(response.url());
    return response.request().method() === method
      && url.pathname === pathname
      && response.status() === 200
      && (query === undefined || query(url.searchParams));
  };
}

function fact(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

async function expectFact(container: Locator, label: string, value: string): Promise<void> {
  const definition = fact(container, label);
  await expect(definition).toBeVisible();
  await expect(definition).toContainText(value);
}

function productRow(container: Locator, productCode: string): Locator {
  return container.getByRole("row").filter({ hasText: productCode });
}

test("C37. inventory candidate flows through READY preview into a current recommendation", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.3.10" });
  const product: ReadyReplenishmentProduct = await fixture.createReadyReplenishmentProduct("journey");
  const inventoryPage = page.getByRole("region", { name: "現在庫" });

  await page.goto("/inventory");
  await expect(inventoryPage).toBeVisible();
  await expect(inventoryPage.getByRole("heading", { name: "現在庫" })).toBeVisible();
  await inventoryPage.getByLabel("商品コード").fill(product.productCode);
  const inventoryRead = page.waitForResponse(apiResponse(
    "/api/v1/inventory",
    "GET",
    (searchParams) => searchParams.get("productCode") === product.productCode,
  ));
  await inventoryPage.getByRole("button", { name: "絞り込む" }).click();
  expect((await inventoryRead).status()).toBe(200);
  const inventoryRow = productRow(inventoryPage, product.productCode);
  await expect(inventoryRow).toHaveCount(1);
  await expect(inventoryRow).toContainText(`${product.listCurrentQuantity} ${product.unitSymbol}`);

  const candidateRead = page.waitForResponse(apiResponse("/api/v1/inventory/replenishment-candidates", "GET"));
  await inventoryPage.getByRole("link", { name: "補充確認候補を表示" }).click();
  expect((await candidateRead).status()).toBe(200);
  const candidatesPage = page.getByRole("region", { name: "補充確認候補" });
  await expect(candidatesPage).toBeVisible();
  const candidateRow = productRow(candidatesPage, product.productCode);
  await expect(candidateRow).toHaveCount(1);
  await expect(candidateRow).toContainText(product.listCurrentQuantity);
  await expect(candidateRow).toContainText(product.listReorderPointQuantity);
  await expect(candidateRow).toContainText(product.unitSymbol);

  const previewRead = page.waitForResponse(apiResponse(`/api/v1/inventory/${product.productId}/replenishment-quantity-preview`, "GET"));
  await candidateRow.getByRole("link", { name: "数量計算" }).click();
  expect((await previewRead).status()).toBe(200);
  const previewPage = page.getByRole("region", { name: "補充数量の制約計算" });
  await expect(previewPage).toBeVisible();
  await expect(previewPage.getByRole("heading", { name: "結果: 計算可能" })).toBeVisible();
  await expectFact(previewPage, "現在庫", `${product.currentQuantity} ${product.unitSymbol}`);
  await expectFact(previewPage, "発注点", `${product.reorderPointQuantity} ${product.unitSymbol}`);
  await expectFact(previewPage, "目標在庫", `${product.targetStockQuantity} ${product.unitSymbol}`);
  await expectFact(previewPage, "raw target gap", `${product.rawTargetGap} ${product.unitSymbol}`);
  await expectFact(previewPage, "計算可能数量", `${product.feasibleQuantity} ${product.unitSymbol}`);
  await expectFact(previewPage, "優先仕入先", `${product.supplierCode} — ${product.supplierName}`);
  await expectFact(previewPage, "優先パッケージ", `${product.packageCode} — ${product.packageName}`);
  await expectFact(previewPage, "パッケージ数", product.packageCount);
  await expectFact(previewPage, "over-order", `${product.overOrderQuantity} ${product.unitSymbol}`);

  const recommendationRead = page.waitForResponse(apiResponse(`/api/v1/inventory/${product.productId}/replenishment-recommendation`, "GET"));
  await previewPage.getByRole("link", { name: "不変recommendationを確認・管理" }).click();
  expect((await recommendationRead).status()).toBe(200);
  const recommendationPage = page.getByRole("region", { name: "補充recommendation" });
  await expect(recommendationPage).toBeVisible();
  await expect(recommendationPage.getByRole("heading", { name: "有効なrecommendationはありません" })).toBeVisible();
  await expect(recommendationPage.getByRole("button", { name: "現在の条件で作成" })).toBeVisible();

  const recommendationCreate = page.waitForResponse(apiResponse(`/api/v1/inventory/${product.productId}/replenishment-recommendation`, "POST"));
  await recommendationPage.getByRole("button", { name: "現在の条件で作成" }).click();
  expect((await recommendationCreate).status()).toBe(200);
  const recommendationOverview = recommendationPage.getByRole("heading", { name: product.productName }).locator("xpath=..");
  await expect(recommendationOverview).toBeVisible();
  await expectFact(recommendationOverview, "snapshot状態", "有効");
  await expectFact(recommendationOverview, "現在との整合性", "現在の入力と一致");
  const snapshot = recommendationPage.getByRole("heading", { name: "確定時の数量説明" }).locator("xpath=..");
  await expectFact(snapshot, "実行可能数量", `${product.recommendationFeasibleQuantity} ${product.unitSymbol}`);
  await expectFact(snapshot, "優先仕入先", `${product.supplierCode} — ${product.supplierName}`);
  await expectFact(snapshot, "優先パッケージ", `${product.packageCode} — ${product.packageName}`);
  await expectFact(snapshot, "パッケージ数", product.packageCount);
  await expectFact(snapshot, "Inventory revision", product.inventoryRevision);
});
