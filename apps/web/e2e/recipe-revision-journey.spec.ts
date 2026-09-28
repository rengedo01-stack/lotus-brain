import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  openRecipeRevisionFixture,
  type RecipeRevisionFixture,
  type RecipeRevisionSource,
} from "./support/recipe-revision-fixture";

let fixture: RecipeRevisionFixture;

test.beforeAll(async () => {
  fixture = await openRecipeRevisionFixture();
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

function recipeForm(page: Page): Locator {
  return page.getByRole("heading", { name: "レシピ下書きを編集", exact: true }).locator("xpath=ancestor::section[1]");
}

function detailValue(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

function bomRow(container: Locator, productCode: string): Locator {
  return container.getByRole("row").filter({ hasText: productCode });
}

async function expectBomRow(container: Locator, productCode: string, quantity: string): Promise<void> {
  const row = bomRow(container, productCode);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(quantity);
}

async function expectSelectedProduct(form: Locator, fieldId: string, productCode: string): Promise<void> {
  await expect(form.locator(fieldId).locator("option:checked")).toContainText(productCode);
}

test("C41. browser revision action creates a copied Recipe draft from an active Recipe", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.8.10" });
  const source: RecipeRevisionSource = await fixture.createActiveRecipe("journey");

  const recipeList = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ACTIVE" && searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await page.goto("/master/recipes");
  expect((await recipeList).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "レシピ／BOM" })).toBeVisible();
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
  const createRevision = sourceDetail.getByRole("button", { name: "新しいrevisionを作成" });
  await expect(createRevision).toBeVisible();

  const revision = page.waitForResponse(apiResponse(`/api/v1/recipes/${source.recipeId}/revisions`, "POST"));
  const productsRead = page.waitForResponse(apiResponse(
    "/api/v1/products",
    "GET",
    (searchParams) => searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  const unitsRead = page.waitForResponse(apiResponse(
    "/api/v1/units",
    "GET",
    (searchParams) => searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await createRevision.click();
  const revisionResponse = await revision;
  expect(revisionResponse.status()).toBe(201);
  const revised = await revisionResponse.json() as { id?: unknown; revision?: unknown; status?: unknown };
  if (typeof revised.id !== "string") throw new Error("Recipe revision response did not contain an id.");
  expect(revised.id).not.toBe(source.recipeId);
  expect(revised.status).toBe("DRAFT");
  expect(revised.revision).toBe(2);
  await page.waitForURL(new RegExp(`/master/recipes/${revised.id}/edit$`));
  expect((await productsRead).status()).toBe(200);
  expect((await unitsRead).status()).toBe(200);

  const editForm = recipeForm(page);
  await expect(editForm).toBeVisible();
  await expect(editForm.locator("#recipe-name")).toHaveValue(source.recipeName);
  await expectSelectedProduct(editForm, "#recipe-output-product", source.output.code);
  await expect(editForm.locator("#recipe-yield-quantity")).toHaveValue(source.yieldQuantity);
  await expect(editForm.locator("#recipe-note")).toHaveValue(source.note);
  await expectSelectedProduct(editForm, "#recipe-item-product-0", source.ingredientA.code);
  await expect(editForm.locator("#recipe-item-quantity-0")).toHaveValue(source.ingredientAQuantity);
  await expectSelectedProduct(editForm, "#recipe-item-product-1", source.ingredientB.code);
  await expect(editForm.locator("#recipe-item-quantity-1")).toHaveValue(source.ingredientBQuantity);

  const revisedRead = page.waitForResponse(apiResponse(`/api/v1/recipes/${revised.id}`, "GET"));
  const revisedRoute = page.waitForURL(new RegExp(`/master/recipes/${revised.id}$`));
  await editForm.getByRole("link", { name: "キャンセル" }).click();
  expect((await revisedRead).status()).toBe(200);
  await revisedRoute;
  const revisedDetail = recipePage(page, source.recipeName);
  await expect(revisedDetail).toBeVisible();
  await expect(revisedDetail.getByText("下書き", { exact: true })).toBeVisible();
  await expect(detailValue(revisedDetail, "Revision")).toContainText("2");
  await expect(detailValue(revisedDetail, "出力商品")).toContainText(source.output.code);
  await expect(detailValue(revisedDetail, "歩留まり")).toContainText(source.yieldQuantity);
  await expect(detailValue(revisedDetail, "メモ")).toContainText(source.note);
  await expectBomRow(revisedDetail, source.ingredientA.code, source.ingredientAQuantity);
  await expectBomRow(revisedDetail, source.ingredientB.code, source.ingredientBQuantity);
  await expect(revisedDetail.getByRole("link", { name: "下書きを編集" })).toBeVisible();
  await expect(revisedDetail.getByRole("button", { name: "有効化" })).toBeVisible();
});
