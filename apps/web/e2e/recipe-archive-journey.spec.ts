import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  openRecipeArchiveFixture,
  type RecipeArchiveFixture,
  type RecipeArchiveSource,
} from "./support/recipe-archive-fixture";

let fixture: RecipeArchiveFixture;

test.beforeAll(async () => {
  fixture = await openRecipeArchiveFixture();
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

function recipePage(page: Page, recipeName: string): Locator {
  return page.getByRole("heading", { name: recipeName, exact: true }).locator("xpath=ancestor::section[1]");
}

function detailValue(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

test("C42. an active Recipe archives into a discoverable archived Recipe without active-only actions", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.9.10" });
  const source: RecipeArchiveSource = await fixture.createActiveRecipe("journey");

  const activeList = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ACTIVE" && searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await page.goto("/master/recipes");
  expect((await activeList).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "レシピ／BOM", exact: true })).toBeVisible();
  await expect(page.locator("#recipe-status-filter")).toHaveValue("ACTIVE");
  const sourceRow = page.getByRole("row").filter({ hasText: source.recipeName });
  await expect(sourceRow).toHaveCount(1);
  await expect(sourceRow).toContainText("有効");
  await expect(sourceRow).toContainText("rev 1");
  const openSource = sourceRow.getByRole("link", { name: "詳細" });
  await expect(openSource).toBeVisible();

  const sourceRead = page.waitForResponse(apiResponse(`/api/v1/recipes/${source.recipeId}`, "GET"));
  const sourceRoute = page.waitForURL(new RegExp(`/master/recipes/${source.recipeId}$`));
  await openSource.click();
  expect((await sourceRead).status()).toBe(200);
  await sourceRoute;
  const sourceDetail = recipePage(page, source.recipeName);
  await expect(sourceDetail).toBeVisible();
  await expect(sourceDetail.getByText("有効", { exact: true })).toBeVisible();
  await expect(detailValue(sourceDetail, "Revision")).toContainText("1");
  const archive = sourceDetail.getByRole("button", { name: "アーカイブ" });
  await expect(archive).toBeVisible();

  const archiveRequest = page.waitForResponse(apiResponse(`/api/v1/recipes/${source.recipeId}/archive`, "POST"));
  await archive.click();
  const archiveResponse = await archiveRequest;
  expect(archiveResponse.status()).toBe(201);
  const archived = await archiveResponse.json() as { id?: unknown; revision?: unknown; rootRecipeId?: unknown; status?: unknown };
  expect(archived.id).toBe(source.recipeId);
  expect(archived.rootRecipeId).toBe(source.recipeId);
  expect(archived.revision).toBe(1);
  expect(archived.status).toBe("ARCHIVED");

  await expect(page).toHaveURL(new RegExp(`/master/recipes/${source.recipeId}$`));
  await expect(sourceDetail.getByText("アーカイブ済み", { exact: true })).toBeVisible();
  await expect(detailValue(sourceDetail, "Revision")).toContainText("1");
  const bomRow = sourceDetail.getByRole("row").filter({ hasText: source.ingredient.code });
  await expect(bomRow).toHaveCount(1);
  await expect(bomRow).toContainText(source.ingredientQuantity);
  await expect(sourceDetail.getByRole("button", { name: "アーカイブ" })).toHaveCount(0);
  await expect(sourceDetail.getByRole("link", { name: "下書きを編集" })).toHaveCount(0);
  await expect(sourceDetail.getByRole("button", { name: "有効化" })).toHaveCount(0);
  await expect(sourceDetail.getByRole("button", { name: "新しいrevisionを作成" })).toBeVisible();

  const activeListAfterArchive = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ACTIVE" && searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await sourceDetail.getByRole("link", { name: "← レシピ一覧", exact: true }).click();
  expect((await activeListAfterArchive).status()).toBe(200);
  await expect(page.locator("#recipe-status-filter")).toHaveValue("ACTIVE");
  await expect(page.getByRole("row").filter({ hasText: source.recipeName })).toHaveCount(0);

  const archivedList = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ARCHIVED" && searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await page.locator("#recipe-status-filter").selectOption("ARCHIVED");
  expect((await archivedList).status()).toBe(200);
  const archivedRow = page.getByRole("row").filter({ hasText: source.recipeName });
  await expect(archivedRow).toHaveCount(1);
  await expect(archivedRow).toContainText("アーカイブ済み");
  await expect(archivedRow).toContainText("rev 1");
  await expect(archivedRow.getByRole("link", { name: "詳細" })).toBeVisible();
});
