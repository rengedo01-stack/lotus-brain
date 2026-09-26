import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { openStocktakeLifecycleFixture, type StocktakeLifecycleFixture, type StocktakeProduct } from "./support/stocktake-lifecycle-fixture";

let fixture: StocktakeLifecycleFixture;

test.beforeAll(async () => {
  fixture = await openStocktakeLifecycleFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

function apiResponse(pathname: string, method: "GET" | "PATCH" | "POST") {
  return (response: Response) => {
    const url = new URL(response.url());
    return response.request().method() === method && url.pathname === pathname;
  };
}

function detailPage(page: Page): Locator {
  return page.getByRole("heading", { name: "棚卸詳細" }).locator("xpath=ancestor::section[1]");
}

function detailValue(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

function productRow(container: Locator, product: StocktakeProduct): Locator {
  return container.getByRole("row").filter({ hasText: product.productCode });
}

test("C38. stocktake flows from draft quantities through confirmation into a posted read-only state", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.4.10" });
  const product = await fixture.createProduct("journey");

  const stocktakeListRead = page.waitForResponse(apiResponse("/api/v1/stocktakes", "GET"));
  await page.goto("/stocktakes");
  expect((await stocktakeListRead).ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "棚卸一覧" })).toBeVisible();
  const createCard = page.getByRole("heading", { name: "新しい棚卸" }).locator("xpath=ancestor::section[1]");
  const createLink = createCard.getByRole("link", { name: "棚卸を作成" });
  await expect(createLink).toBeVisible();

  await createLink.click();
  await expect(page.getByRole("heading", { name: "棚卸を新規作成" })).toBeVisible();
  const productInput = page.getByLabel("商品");
  await expect(productInput).toBeVisible();
  await productInput.selectOption(product.productId);

  const create = page.waitForResponse(apiResponse("/api/v1/stocktakes", "POST"));
  const createdRoute = page.waitForURL(/\/stocktakes\/[^/]+$/);
  await page.getByRole("button", { name: "下書きを作成" }).click();
  const createResponse = await create;
  await createdRoute;
  expect(createResponse.status()).toBe(201);

  let detail = detailPage(page);
  await expect(detail).toBeVisible();
  await expect(detail.getByText("下書き", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toBeVisible();

  const editRoute = page.waitForURL(/\/stocktakes\/[^/]+\/edit$/);
  await detail.getByRole("link", { name: "下書きを編集" }).click();
  await editRoute;
  await expect(page.getByRole("heading", { name: "棚卸下書きを編集" })).toBeVisible();
  await page.getByLabel("実棚数量").fill(product.expectedCountedQuantity);

  const stocktakeId = new URL(page.url()).pathname.split("/").at(-2);
  expect(stocktakeId).toBeDefined();
  const update = page.waitForResponse(apiResponse(`/api/v1/stocktakes/${stocktakeId}`, "PATCH"));
  const updatedRoute = page.waitForURL(new RegExp(`/stocktakes/${stocktakeId}$`));
  await page.getByRole("button", { name: "下書きを保存" }).click();
  expect((await update).ok()).toBe(true);
  await updatedRoute;

  detail = detailPage(page);
  await expect(detail).toBeVisible();
  const row = productRow(detail, product);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(product.productName);
  await expect(row).toContainText(product.unitSymbol);
  await expect(row).toContainText(product.expectedBookQuantity);
  await expect(row).toContainText(product.expectedCountedQuantity);
  await expect(row).toContainText(product.expectedDifferenceQuantity);

  const confirm = page.waitForResponse(apiResponse(`/api/v1/stocktakes/${stocktakeId}/confirm`, "POST"));
  await detail.getByRole("button", { name: "棚卸を確認" }).click();
  expect((await confirm).ok()).toBe(true);
  await expect(detail.getByText("確認済み", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "棚卸を計上" })).toBeVisible();

  const post = page.waitForResponse(apiResponse(`/api/v1/stocktakes/${stocktakeId}/post`, "POST"));
  await detail.getByRole("button", { name: "棚卸を計上" }).click();
  expect((await post).status()).toBe(200);
  await expect(detail.getByText("計上済み", { exact: true })).toBeVisible();
  await expect(detailValue(detail, "完了日時")).not.toContainText("—");
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "棚卸を確認" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "棚卸を計上" })).toHaveCount(0);
});
