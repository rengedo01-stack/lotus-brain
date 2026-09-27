import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { openProductionLifecycleFixture, type ProductionLifecycleFixture, type ProductionRecipe } from "./support/production-lifecycle-fixture";

let fixture: ProductionLifecycleFixture;

test.beforeAll(async () => {
  fixture = await openProductionLifecycleFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

function apiResponse(pathname: string, method: "GET" | "POST", query?: (searchParams: URLSearchParams) => boolean) {
  return (response: Response) => {
    const url = new URL(response.url());
    return response.request().method() === method
      && url.pathname === pathname
      && (query === undefined || query(url.searchParams));
  };
}

function detailPage(page: Page): Locator {
  return page.getByRole("heading", { name: "生産詳細" }).locator("xpath=ancestor::section[1]");
}

function detailValue(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

test("C39. production flows from an active Recipe through confirmation into a posted read-only state", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.5.10" });
  const recipe: ProductionRecipe = await fixture.createActiveRecipe("journey");

  const productionList = page.waitForResponse(apiResponse(
    "/api/v1/productions",
    "GET",
    (searchParams) => searchParams.get("limit") === "50",
  ));
  await page.goto("/productions");
  expect((await productionList).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "生産一覧" })).toBeVisible();
  const createCard = page.getByRole("heading", { name: "新しい生産" }).locator("xpath=ancestor::section[1]");
  const createLink = createCard.getByRole("link", { name: "生産を作成" });
  await expect(createLink).toBeVisible();

  const activeRecipes = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ACTIVE",
  ));
  await createLink.click();
  expect((await activeRecipes).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "生産を新規作成" })).toBeVisible();
  const recipeInput = page.getByLabel("有効なレシピ");
  await expect(recipeInput).toBeVisible();
  await recipeInput.selectOption(recipe.recipeId);
  await expect(recipeInput).toHaveValue(recipe.recipeId);
  const recipePreview = page.getByRole("heading", { name: "選択した有効レシピ" }).locator("xpath=ancestor::section[1]");
  await expect(recipePreview).toContainText(recipe.outputProductId);
  await page.getByLabel("生産日").fill("2026-09-27");
  await page.getByLabel("予定生産量").fill(recipe.plannedQuantity);

  const create = page.waitForResponse(apiResponse("/api/v1/productions", "POST"));
  const createdRoute = page.waitForURL(/\/productions\/[^/]+$/);
  await page.getByRole("button", { name: "下書きを作成" }).click();
  const createResponse = await create;
  await createdRoute;
  expect(createResponse.status()).toBe(201);
  expect(createResponse.request().postDataJSON()).toMatchObject({
    plannedQuantity: recipe.plannedQuantity,
    recipeId: recipe.recipeId,
  });

  const created = await createResponse.json() as { id?: unknown };
  if (typeof created.id !== "string") {
    throw new Error("Production creation response did not contain an id.");
  }
  const productionId = created.id;
  const detail = detailPage(page);
  await expect(detail).toBeVisible();
  await expect(detail.getByText("下書き", { exact: true })).toBeVisible();
  await expect(detail.getByText(recipe.outputProductId, { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "生産を確認" })).toBeVisible();

  const confirm = page.waitForResponse(apiResponse(`/api/v1/productions/${productionId}/confirm`, "POST"));
  await detail.getByRole("button", { name: "生産を確認" }).click();
  expect((await confirm).status()).toBe(201);
  await expect(detail.getByText("確認済み", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toHaveCount(0);
  const actualQuantity = detail.getByLabel("実績生産量");
  await expect(actualQuantity).toBeVisible();
  await actualQuantity.fill(recipe.actualQuantity);
  await expect(detail.getByRole("button", { name: "生産を計上" })).toBeVisible();

  const post = page.waitForResponse(apiResponse(`/api/v1/productions/${productionId}/post`, "POST"));
  await detail.getByRole("button", { name: "生産を計上" }).click();
  const postResponse = await post;
  expect(postResponse.status()).toBe(200);
  expect(postResponse.request().postDataJSON()).toEqual({ actualQuantity: recipe.actualQuantity });
  await expect(detail.getByText("計上済み", { exact: true })).toBeVisible();
  await expect(detailValue(detail, "実績生産量（サーバー確定）")).toContainText(recipe.actualQuantity);
  await expect(detailValue(detail, "計上日時（サーバー確定）")).not.toContainText("—");
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "生産を確認" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "生産を計上" })).toHaveCount(0);
});
