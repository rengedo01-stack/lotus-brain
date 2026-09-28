import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import {
  openRecipeLifecycleFixture,
  type RecipeLifecycleFixture,
  type RecipeLifecycleMasters,
} from "./support/recipe-lifecycle-fixture";

let fixture: RecipeLifecycleFixture;

test.beforeAll(async () => {
  fixture = await openRecipeLifecycleFixture();
});

test.afterAll(async () => {
  await fixture.close();
});

function apiResponse(pathname: string, method: "GET" | "PATCH" | "POST", query?: (searchParams: URLSearchParams) => boolean) {
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

function recipeForm(page: Page, heading: "レシピ下書きを作成" | "レシピ下書きを編集"): Locator {
  return page.getByRole("heading", { name: heading, exact: true }).locator("xpath=ancestor::section[1]");
}

function detailValue(container: Locator, label: string): Locator {
  return container.getByText(label, { exact: true }).locator("xpath=..");
}

function bomRow(container: Locator, productCode: string): Locator {
  return container.getByRole("row").filter({ hasText: productCode });
}

async function expectBomRow(container: Locator, productCode: string, quantity: string, unitCode: string): Promise<void> {
  const row = bomRow(container, productCode);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(quantity);
  await expect(row).toContainText(unitCode);
}

test("C40. Recipe flows from a browser-created draft through BOM editing into an active read-only structure", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.18.6.10" });
  const masters: RecipeLifecycleMasters = await fixture.createMasters("journey");

  const recipeList = page.waitForResponse(apiResponse(
    "/api/v1/recipes",
    "GET",
    (searchParams) => searchParams.get("status") === "ACTIVE" && searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  await page.goto("/master/recipes");
  expect((await recipeList).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "レシピ／BOM" })).toBeVisible();
  const createRecipe = page.getByRole("link", { name: "レシピを作成" });
  await expect(createRecipe).toBeVisible();

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
  await createRecipe.click();
  expect((await productsRead).status()).toBe(200);
  expect((await unitsRead).status()).toBe(200);
  const createForm = recipeForm(page, "レシピ下書きを作成");
  await expect(createForm).toBeVisible();
  await createForm.locator("#recipe-name").fill(masters.recipeName);
  await createForm.locator("#recipe-output-product").selectOption(masters.output.id);
  await createForm.locator("#recipe-yield-quantity").fill(masters.yieldQuantity);
  await createForm.locator("#recipe-yield-unit").selectOption(masters.unit.id);
  await createForm.locator("#recipe-note").fill(masters.note);
  await createForm.locator("#recipe-item-product-0").selectOption(masters.ingredientA.id);
  await createForm.locator("#recipe-item-unit-0").selectOption(masters.unit.id);
  await createForm.locator("#recipe-item-quantity-0").fill(masters.ingredientAQuantity);

  const create = page.waitForResponse(apiResponse("/api/v1/recipes", "POST"));
  const createdRoute = page.waitForURL(/\/master\/recipes\/[^/]+$/);
  await createForm.getByRole("button", { name: "下書きを保存" }).click();
  const createResponse = await create;
  await createdRoute;
  expect(createResponse.status()).toBe(201);
  expect(createResponse.request().postDataJSON()).toEqual({
    name: masters.recipeName,
    outputProductId: masters.output.id,
    yieldQuantity: masters.yieldQuantity,
    yieldUnitId: masters.unit.id,
    note: masters.note,
    items: [{ productId: masters.ingredientA.id, unitId: masters.unit.id, quantity: masters.ingredientAQuantity }],
  });
  const created = await createResponse.json() as { id?: unknown };
  if (typeof created.id !== "string") throw new Error("Recipe creation response did not contain an id.");
  const recipeId = created.id;

  let detail = recipePage(page, masters.recipeName);
  await expect(detail).toBeVisible();
  await expect(detail.getByText("下書き", { exact: true })).toBeVisible();
  await expect(detailValue(detail, "出力商品")).toContainText(masters.output.code);
  await expect(detailValue(detail, "歩留まり")).toContainText(masters.yieldQuantity);
  await expect(detailValue(detail, "歩留まり単位")).toContainText(masters.unit.code);
  await expectBomRow(detail, masters.ingredientA.code, masters.ingredientAQuantity, masters.unit.code);
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "有効化" })).toBeVisible();

  const recipeRead = page.waitForResponse(apiResponse(`/api/v1/recipes/${recipeId}`, "GET"));
  const editProductsRead = page.waitForResponse(apiResponse(
    "/api/v1/products",
    "GET",
    (searchParams) => searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  const editUnitsRead = page.waitForResponse(apiResponse(
    "/api/v1/units",
    "GET",
    (searchParams) => searchParams.get("limit") === "100" && searchParams.get("offset") === "0",
  ));
  const editRoute = page.waitForURL(new RegExp(`/master/recipes/${recipeId}/edit$`));
  await detail.getByRole("link", { name: "下書きを編集" }).click();
  await editRoute;
  expect((await recipeRead).status()).toBe(200);
  expect((await editProductsRead).status()).toBe(200);
  expect((await editUnitsRead).status()).toBe(200);
  const editForm = recipeForm(page, "レシピ下書きを編集");
  await expect(editForm).toBeVisible();
  await expect(editForm.locator("#recipe-item-product-0")).toHaveValue(masters.ingredientA.id);
  await expect(editForm.locator("#recipe-item-unit-0")).toHaveValue(masters.unit.id);
  await expect(editForm.locator("#recipe-item-quantity-0")).toHaveValue(masters.ingredientAQuantity);
  await editForm.getByRole("button", { name: "行を追加" }).click();
  const ingredientBProduct = editForm.locator("#recipe-item-product-1");
  const ingredientBUnit = editForm.locator("#recipe-item-unit-1");
  const ingredientBQuantity = editForm.locator("#recipe-item-quantity-1");
  await expect(ingredientBProduct).toBeVisible();
  await expect(ingredientBUnit).toBeVisible();
  await expect(ingredientBQuantity).toBeVisible();
  await ingredientBProduct.selectOption(masters.ingredientB.id);
  await ingredientBUnit.selectOption(masters.unit.id);
  await ingredientBQuantity.fill(masters.ingredientBQuantity);

  const update = page.waitForResponse(apiResponse(`/api/v1/recipes/${recipeId}`, "PATCH"));
  const updatedRoute = page.waitForURL(new RegExp(`/master/recipes/${recipeId}$`));
  await editForm.getByRole("button", { name: "下書きを保存" }).click();
  const updateResponse = await update;
  await updatedRoute;
  expect(updateResponse.status()).toBe(200);
  expect(updateResponse.request().postDataJSON()).toEqual({
    name: masters.recipeName,
    outputProductId: masters.output.id,
    yieldQuantity: masters.yieldQuantity,
    yieldUnitId: masters.unit.id,
    note: masters.note,
    items: [
      { productId: masters.ingredientA.id, unitId: masters.unit.id, quantity: masters.ingredientAQuantity },
      { productId: masters.ingredientB.id, unitId: masters.unit.id, quantity: masters.ingredientBQuantity },
    ],
  });

  detail = recipePage(page, masters.recipeName);
  await expect(detail).toBeVisible();
  await expectBomRow(detail, masters.ingredientA.code, masters.ingredientAQuantity, masters.unit.code);
  await expectBomRow(detail, masters.ingredientB.code, masters.ingredientBQuantity, masters.unit.code);

  const activate = page.waitForResponse(apiResponse(`/api/v1/recipes/${recipeId}/activate`, "POST"));
  await detail.getByRole("button", { name: "有効化" }).click();
  expect((await activate).status()).toBe(201);
  await expect(detail.getByText("有効", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "下書きを編集" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "有効化" })).toHaveCount(0);
  await expectBomRow(detail, masters.ingredientA.code, masters.ingredientAQuantity, masters.unit.code);
  await expectBomRow(detail, masters.ingredientB.code, masters.ingredientBQuantity, masters.unit.code);
  await expect(detail.getByRole("button", { name: "アーカイブ" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "新しいrevisionを作成" })).toBeVisible();
});
