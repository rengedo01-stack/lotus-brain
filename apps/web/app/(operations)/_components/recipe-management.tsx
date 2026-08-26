"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api-client";
import { isUnitList, type Unit } from "@/lib/master-data";
import { isProductList, formatOperationalDate, type Product } from "@/lib/products";
import { stageRecipeNavigation, takeStagedRecipe } from "@/lib/recipe-navigation";
import {
  RECIPE_STATUSES,
  initialRecipeFormValues,
  isRecipe,
  isRecipeList,
  recipeDraftPayload,
  recipeFormFromRecipe,
  recipeStatusLabel,
  validateRecipeForm,
  type Recipe,
  type RecipeFieldErrors,
  type RecipeFormValues,
  type RecipeItemFields,
  type RecipeStatus,
} from "@/lib/recipes";
import { Field, fieldErrorProps, FormError, MasterNavigation, SelectInput, TextArea, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

const PAGE_SIZE = 100;

type RecipeState =
  | { status: "loading" }
  | { status: "ready"; recipe: Recipe }
  | { status: "not_found" }
  | { status: "error"; message: string };

type RecipeListState =
  | { status: "loading" }
  | { status: "ready"; recipes: Recipe[] }
  | { status: "error"; message: string };

type MastersState =
  | { status: "loading" }
  | { status: "ready"; products: Product[]; units: Unit[] }
  | { status: "error"; message: string };

type RecipeAction = "activate" | "archive" | "revision" | null;

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "レシピ情報を処理できませんでした。時間をおいて再試行してください。";
}

function handleRecipeError(error: unknown, refreshAuthentication: () => void): "unauthorized" | "forbidden" | "other" {
  if (!(error instanceof ApiError)) return "other";
  if (error.kind === "unauthorized") return "unauthorized";
  if (error.kind === "forbidden") {
    refreshAuthentication();
    return "forbidden";
  }
  return "other";
}

async function requestRecipe(api: ApiClient, recipeId: string): Promise<Recipe> {
  const payload = await api.request<unknown>(`/recipes/${encodeURIComponent(recipeId)}`);
  if (!isRecipe(payload)) throw new ApiError("server");
  return payload;
}

function useRecipeMasters(shouldLoad: boolean): { retry(): void; state: MastersState } {
  const { api, refreshAuthentication } = useOperationalApp();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<MastersState>({ status: "loading" });

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    void Promise.all([
      api.request<unknown>(`/products?limit=${PAGE_SIZE}&offset=0`),
      api.request<unknown>(`/units?limit=${PAGE_SIZE}&offset=0`),
    ]).then(([productsPayload, unitsPayload]) => {
      if (!isProductList(productsPayload) || !isUnitList(unitsPayload)) throw new ApiError("server");
      if (active) setState({ status: "ready", products: productsPayload, units: unitsPayload });
    }).catch((error: unknown) => {
      if (!active || handleRecipeError(error, refreshAuthentication) === "unauthorized") return;
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey, shouldLoad]);

  return { retry: () => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }, state };
}

function ProductLabel({ id, products }: Readonly<{ id: string; products: Product[] }>) {
  const product = products.find((candidate) => candidate.id === id);
  return <>{product === undefined ? id : `${product.code} — ${product.name}${product.status === "INACTIVE" ? " [無効]" : ""}`}</>;
}

function UnitLabel({ id, units }: Readonly<{ id: string; units: Unit[] }>) {
  const unit = units.find((candidate) => candidate.id === id);
  return <>{unit === undefined ? id : `${unit.code} — ${unit.name} (${unit.symbol})${unit.status === "INACTIVE" ? " [無効]" : ""}`}</>;
}

export function RecipeWorkspacePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [statusFilter, setStatusFilter] = useState<RecipeStatus>("ACTIVE");
  const [recipeId, setRecipeId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<RecipeListState>({ status: "loading" });

  useEffect(() => {
    if (!permissions.has("master.read")) return;
    let active = true;
    void api.request<unknown>(`/recipes?status=${statusFilter}&limit=${PAGE_SIZE}&offset=0`).then((payload) => {
      if (!isRecipeList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", recipes: payload });
    }).catch((error: unknown) => {
      if (!active || handleRecipeError(error, refreshAuthentication) === "unauthorized") return;
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, permissions, refreshAuthentication, retryKey, statusFilter]);

  function openRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = recipeId.trim();
    if (id.length === 0) {
      setLookupError("レシピIDを入力してください。");
      return;
    }
    router.push(`/master/recipes/${encodeURIComponent(id)}`);
  }

  if (!permissions.has("master.read")) return <RecipeReadAccessRequired />;

  return <section aria-labelledby="recipes-title">
    <MasterNavigation />
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-blue-700">マスター</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="recipes-title">レシピ／BOM</h1><p className="mt-2 text-sm text-slate-700">有効レシピを確認し、IDで全状態のレシピを開けます。構造変更は下書きだけで行います。</p></div>{permissions.has("master.write") && <Link className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/recipes/new">レシピを作成</Link>}</div>
    <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><section className="rounded-xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-3"><Field htmlFor="recipe-status-filter" label="表示状態"><SelectInput id="recipe-status-filter" onChange={(event) => { setState({ status: "loading" }); setStatusFilter(event.target.value as RecipeStatus); }} value={statusFilter}>{RECIPE_STATUSES.map((status) => <option key={status} value={status}>{recipeStatusLabel(status)}</option>)}</SelectInput></Field><p className="text-sm text-slate-600">最大{PAGE_SIZE}件</p></div>{state.status === "loading" && <p className="mt-6 text-sm text-slate-700" role="status">レシピを読み込んでいます…</p>}{state.status === "error" && <LoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />}{state.status === "ready" && state.recipes.length === 0 && <p className="mt-6 text-sm text-slate-700">該当するレシピはありません。</p>}{state.status === "ready" && state.recipes.length > 0 && <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">レシピ名</th><th className="px-4 py-3 font-semibold">系譜／版</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3 font-semibold"><span className="sr-only">詳細</span></th></tr></thead><tbody className="divide-y divide-slate-100">{state.recipes.map((recipe) => <tr className="hover:bg-slate-50" key={recipe.id}><td className="px-4 py-3 font-medium text-slate-950">{recipe.name}</td><td className="px-4 py-3 text-xs text-slate-700"><span className="font-mono">{recipe.rootRecipeId}</span> / rev {recipe.revision}</td><td className="px-4 py-3"><RecipeStatusBadge status={recipe.status} /></td><td className="px-4 py-3 text-right"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href={`/master/recipes/${encodeURIComponent(recipe.id)}`}>詳細</Link></td></tr>)}</tbody></table></div>}</section><section aria-labelledby="recipe-open-title" className="rounded-xl bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-950" id="recipe-open-title">IDで開く</h2><p className="mt-2 text-sm text-slate-700">inactive masterを参照する履歴レシピも、ID指定なら表示できます。</p><form className="mt-5" noValidate onSubmit={openRecipe}><Field error={lookupError ?? undefined} htmlFor="recipe-id" label="レシピID" required><TextInput id="recipe-id" onChange={(event) => { setRecipeId(event.target.value); setLookupError(null); }} value={recipeId} /></Field><button className="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" type="submit">詳細を開く</button></form></section></div>
  </section>;
}

export function RecipeCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const masters = useRecipeMasters(permissions.has("master.read"));
  const [values, setValues] = useState<RecipeFormValues>(initialRecipeFormValues);
  const [errors, setErrors] = useState<RecipeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRecipeForm(values);
    setErrors(nextErrors); setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/recipes", { method: "POST", body: recipeDraftPayload(values) });
      if (!isRecipe(created)) throw new ApiError("server");
      stageRecipeNavigation(created);
      router.replace(`/master/recipes/${encodeURIComponent(created.id)}`);
    } catch (error: unknown) {
      if (handleRecipeError(error, refreshAuthentication) !== "unauthorized") setFormError(errorMessage(error));
    } finally { setIsSubmitting(false); }
  }

  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/recipes" />;
  if (!permissions.has("master.read")) return <RecipeReadAccessRequired />;
  return <section aria-labelledby="recipe-create-title" className="max-w-5xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="recipe-create-title">レシピ下書きを作成</h1><p className="mt-2 text-sm text-slate-700">出力、歩留まり、BOMをDecimal文字列のまま登録します。在庫・原価・消費量はここで計算しません。</p><MastersGate masters={masters} >{({ products, units }) => <RecipeForm cancelHref="/master/recipes" errors={errors} formError={formError} isSubmitting={isSubmitting} onSubmit={submit} onValuesChange={setValues} products={products} units={units} values={values} />}</MastersGate></section>;
}

export function RecipeEditPage({ recipeId }: Readonly<{ recipeId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const stagedRecipe = takeStagedRecipe(recipeId);
  const stagedRecipeRef = useRef(stagedRecipe);
  const masters = useRecipeMasters(permissions.has("master.read"));
  const [state, setState] = useState<RecipeState>(() => stagedRecipe === undefined ? { status: "loading" } : { status: "ready", recipe: stagedRecipe });
  const [values, setValues] = useState<RecipeFormValues>(() => stagedRecipe === undefined ? initialRecipeFormValues() : recipeFormFromRecipe(stagedRecipe));
  const [errors, setErrors] = useState<RecipeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (retryKey === 0 && stagedRecipeRef.current?.id === recipeId) {
      stagedRecipeRef.current = undefined;
      return;
    }
    let active = true;
    void requestRecipe(api, recipeId).then((recipe) => { if (active) { setState({ status: "ready", recipe }); setValues(recipeFormFromRecipe(recipe)); } }).catch((error: unknown) => {
      if (!active || handleRecipeError(error, refreshAuthentication) === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" }); else setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, recipeId, refreshAuthentication, retryKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRecipeForm(values);
    setErrors(nextErrors); setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/recipes/${encodeURIComponent(recipeId)}`, { method: "PATCH", body: recipeDraftPayload(values) });
      if (!isRecipe(updated)) throw new ApiError("server");
      stageRecipeNavigation(updated);
      router.replace(`/master/recipes/${encodeURIComponent(updated.id)}`);
    } catch (error: unknown) {
      if (handleRecipeError(error, refreshAuthentication) !== "unauthorized") setFormError(errorMessage(error));
    } finally { setIsSubmitting(false); }
  }

  if (!permissions.has("master.write")) return <WriteAccessRequired backHref={`/master/recipes/${encodeURIComponent(recipeId)}`} />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">レシピを読み込んでいます…</p>;
  if (state.status === "not_found") return <RecipeNotFound />;
  if (state.status === "error") return <LoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />;
  if (state.recipe.status !== "DRAFT") return <section className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950">構造は編集できません</h1><p className="mt-3 text-sm text-amber-900">ACTIVEまたはARCHIVEDのレシピは構造を読み取り専用として扱います。変更には新しい下書きrevisionを作成してください。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/master/recipes/${encodeURIComponent(recipeId)}`}>レシピ詳細へ戻る</Link></section>;
  return <section aria-labelledby="recipe-edit-title" className="max-w-5xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="recipe-edit-title">レシピ下書きを編集</h1><p className="mt-2 text-sm text-slate-700">下書きだけが構造を編集できます。revision 2以降では出力商品identityを変更しません。</p><MastersGate masters={masters}>{({ products, units }) => <RecipeForm cancelHref={`/master/recipes/${encodeURIComponent(recipeId)}`} errors={errors} fixedOutput={state.recipe.revision > 1} formError={formError} isSubmitting={isSubmitting} onSubmit={submit} onValuesChange={setValues} products={products} units={units} values={values} />}</MastersGate></section>;
}

export function RecipeDetailPage({ recipeId }: Readonly<{ recipeId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const stagedRecipe = takeStagedRecipe(recipeId);
  const stagedRecipeRef = useRef(stagedRecipe);
  const masters = useRecipeMasters(permissions.has("master.read"));
  const [state, setState] = useState<RecipeState>(() => stagedRecipe === undefined ? { status: "loading" } : { status: "ready", recipe: stagedRecipe });
  const [action, setAction] = useState<RecipeAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (retryKey === 0 && stagedRecipeRef.current?.id === recipeId) {
      stagedRecipeRef.current = undefined;
      return;
    }
    let active = true;
    void requestRecipe(api, recipeId).then((recipe) => { if (active) { setState({ status: "ready", recipe }); setActionError(null); setReloadRequired(false); } }).catch((error: unknown) => {
      if (!active || handleRecipeError(error, refreshAuthentication) === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" }); else setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, recipeId, refreshAuthentication, retryKey]);

  function reload() { setState({ status: "loading" }); setRetryKey((value) => value + 1); }
  async function lifecycle(nextAction: Exclude<RecipeAction, null>) {
    if (state.status !== "ready" || action !== null || reloadRequired) return;
    const recipe = state.recipe;
    if ((nextAction === "activate" && recipe.status !== "DRAFT") || (nextAction === "archive" && recipe.status !== "ACTIVE") || (nextAction === "revision" && recipe.status === "DRAFT")) return;
    setAction(nextAction); setActionError(null);
    const path = nextAction === "activate" ? `/recipes/${encodeURIComponent(recipe.id)}/activate` : nextAction === "archive" ? `/recipes/${encodeURIComponent(recipe.id)}/archive` : `/recipes/${encodeURIComponent(recipe.id)}/revisions`;
    try {
      const result = await api.request<unknown>(path, { method: "POST" });
      if (!isRecipe(result)) throw new ApiError("server");
      if (nextAction === "revision") {
        stageRecipeNavigation(result);
        router.replace(`/master/recipes/${encodeURIComponent(result.id)}/edit`);
      } else setState({ status: "ready", recipe: result });
    } catch (error: unknown) {
      const kind = handleRecipeError(error, refreshAuthentication);
      if (kind !== "unauthorized") setActionError(errorMessage(error));
      if (error instanceof ApiError && error.kind === "conflict") setReloadRequired(true);
    } finally { setAction(null); }
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">レシピを読み込んでいます…</p>;
  if (state.status === "not_found") return <RecipeNotFound />;
  if (state.status === "error") return <LoadError message={state.message} retry={reload} />;
  const recipe = state.recipe;
  const productMasters = masters.state.status === "ready" ? masters.state.products : [];
  const unitMasters = masters.state.status === "ready" ? masters.state.units : [];
  const canWrite = permissions.has("master.write") && !reloadRequired;
  return <section aria-labelledby="recipe-detail-title" className="max-w-6xl"><MasterNavigation /><Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/recipes">← レシピ一覧</Link><div className="mt-5 rounded-xl bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-xs text-slate-600">{recipe.id}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="recipe-detail-title">{recipe.name}</h1></div><RecipeStatusBadge status={recipe.status} /></div><p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">系譜、出力、BOMはサーバーが保持するRecipe定義です。ACTIVEとARCHIVEDの構造は読み取り専用で、Production参照済みRecipeの不変性はバックエンドとDBが最終的に保証します。</p>{reloadRequired ? <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-950" role="alert">状態が更新されています。操作を再実行せず、最新状態を確認してください。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reload} type="button">最新状態を再読み込み</button></section> : <div className="mt-5 flex flex-wrap gap-3">{canWrite && recipe.status === "DRAFT" && <><Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" href={`/master/recipes/${encodeURIComponent(recipe.id)}/edit`}>下書きを編集</Link><ActionButton action={action} actionName="activate" label="有効化" onClick={() => void lifecycle("activate")} pendingLabel="有効化しています…" /></>}{canWrite && recipe.status === "ACTIVE" && <><ActionButton action={action} actionName="archive" label="アーカイブ" onClick={() => void lifecycle("archive")} pendingLabel="アーカイブしています…" /><ActionButton action={action} actionName="revision" label="新しいrevisionを作成" onClick={() => void lifecycle("revision")} pendingLabel="revisionを作成しています…" /></>}{canWrite && recipe.status === "ARCHIVED" && <ActionButton action={action} actionName="revision" label="新しいrevisionを作成" onClick={() => void lifecycle("revision")} pendingLabel="revisionを作成しています…" />}</div>}<FormError message={actionError} /><dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-3"><DetailItem label="ルートRecipe ID" value={recipe.rootRecipeId} /><DetailItem label="Revision" value={String(recipe.revision)} /><DetailItem label="出力商品" value={<ProductLabel id={recipe.outputProductId} products={productMasters} />} /><DetailItem label="歩留まり" value={recipe.yieldQuantity} /><DetailItem label="歩留まり単位" value={<UnitLabel id={recipe.yieldUnitId} units={unitMasters} />} /><DetailItem label="メモ" value={recipe.note ?? "—"} /><DetailItem label="作成日時" value={formatOperationalDate(recipe.createdAt)} /><DetailItem label="更新日時" value={formatOperationalDate(recipe.updatedAt)} /></dl><section aria-labelledby="recipe-items-title" className="mt-8 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold text-slate-950" id="recipe-items-title">BOM</h2><p className="mt-1 text-sm text-slate-700">数量は作成・更新時にサーバーへDecimal文字列で渡されるスナップショットではないRecipe構造です。同一商品は1行だけです。</p><div className="mt-4 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">行</th><th className="px-4 py-3 font-semibold">商品</th><th className="px-4 py-3 text-right font-semibold">数量</th><th className="px-4 py-3 font-semibold">単位</th></tr></thead><tbody className="divide-y divide-slate-100">{[...recipe.items].sort((left, right) => left.sortOrder - right.sortOrder).map((item) => <tr key={item.id}><td className="px-4 py-3 text-slate-700">{item.sortOrder + 1}</td><td className="px-4 py-3 text-slate-950"><ProductLabel id={item.productId} products={productMasters} /></td><td className="px-4 py-3 text-right text-slate-950">{item.quantity}</td><td className="px-4 py-3 text-slate-950"><UnitLabel id={item.unitId} units={unitMasters} /></td></tr>)}</tbody></table></div></section></div></section>;
}

function RecipeForm({ cancelHref, errors, fixedOutput = false, formError, isSubmitting, onSubmit, onValuesChange, products, units, values }: Readonly<{ cancelHref: string; errors: RecipeFieldErrors; fixedOutput?: boolean; formError: string | null; isSubmitting: boolean; onSubmit(event: FormEvent<HTMLFormElement>): void; onValuesChange(values: RecipeFormValues): void; products: Product[]; units: Unit[]; values: RecipeFormValues }>) {
  function change(field: Exclude<keyof RecipeFormValues, "items">, value: string) { onValuesChange({ ...values, [field]: value }); }
  function changeItem(index: number, field: Exclude<keyof RecipeItemFields, "clientKey">, value: string) { onValuesChange({ ...values, items: values.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }); }
  function addItem() { if (values.items.length < 100) onValuesChange({ ...values, items: [...values.items, { clientKey: `item-${values.items.length + 1}-${Date.now()}`, productId: "", quantity: "", unitId: "" }] }); }
  function removeItem(index: number) { onValuesChange({ ...values, items: values.items.filter((_, itemIndex) => itemIndex !== index) }); }
  return <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={onSubmit}><FormError message={formError} /><div className="grid gap-5 sm:grid-cols-2"><Field error={errors.name} htmlFor="recipe-name" label="レシピ名" required><TextInput {...fieldErrorProps("name", "recipe-name", errors)} id="recipe-name" onChange={(event) => change("name", event.target.value)} required value={values.name} /></Field><Field error={errors.outputProductId} htmlFor="recipe-output-product" label="出力商品" required><SelectInput {...fieldErrorProps("outputProductId", "recipe-output-product", errors)} disabled={fixedOutput} id="recipe-output-product" onChange={(event) => change("outputProductId", event.target.value)} required value={values.outputProductId}><option value="">選択してください</option>{products.map((product) => <option disabled={product.status !== "ACTIVE" && product.id !== values.outputProductId} key={product.id} value={product.id}>{product.code} — {product.name}{product.status === "INACTIVE" ? " [無効]" : ""}</option>)}</SelectInput></Field><Field error={errors.yieldQuantity} htmlFor="recipe-yield-quantity" label="歩留まり" required><TextInput {...fieldErrorProps("yieldQuantity", "recipe-yield-quantity", errors)} id="recipe-yield-quantity" inputMode="decimal" onChange={(event) => change("yieldQuantity", event.target.value)} required value={values.yieldQuantity} /></Field><Field error={errors.yieldUnitId} htmlFor="recipe-yield-unit" label="歩留まり単位" required><SelectInput {...fieldErrorProps("yieldUnitId", "recipe-yield-unit", errors)} id="recipe-yield-unit" onChange={(event) => change("yieldUnitId", event.target.value)} required value={values.yieldUnitId}><option value="">選択してください</option>{units.map((unit) => <option disabled={unit.status !== "ACTIVE" && unit.id !== values.yieldUnitId} key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}){unit.status === "INACTIVE" ? " [無効]" : ""}</option>)}</SelectInput></Field><div className="sm:col-span-2"><Field htmlFor="recipe-note" label="メモ"><TextArea id="recipe-note" maxLength={1000} onChange={(event) => change("note", event.target.value)} rows={3} value={values.note} /></Field></div></div>{fixedOutput && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">このrevisionの出力商品identityは変更しません。バックエンドとDBが系譜の不変性を最終保証します。</p>}<section aria-labelledby="recipe-form-items-title" className="border-t border-slate-200 pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950" id="recipe-form-items-title">BOM</h2><p className="mt-1 text-sm text-slate-700">同一商品は1行だけ指定します。数量はDecimal(24,9)の文字列です。</p></div><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={values.items.length >= 100} onClick={addItem} type="button">行を追加</button></div>{errors.items !== undefined && <p className="mt-3 text-sm text-red-800" role="alert">{errors.items}</p>}<div className="mt-4 space-y-4">{values.items.map((item, index) => <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]" key={item.clientKey}><Field error={errors[`items.${index}.productId`]} htmlFor={`recipe-item-product-${index}`} label="商品" required><SelectInput {...fieldErrorProps(`items.${index}.productId`, `recipe-item-product-${index}`, errors)} id={`recipe-item-product-${index}`} onChange={(event) => changeItem(index, "productId", event.target.value)} value={item.productId}><option value="">選択してください</option>{products.map((product) => <option disabled={product.status !== "ACTIVE" && product.id !== item.productId} key={product.id} value={product.id}>{product.code} — {product.name}{product.status === "INACTIVE" ? " [無効]" : ""}</option>)}</SelectInput></Field><Field error={errors[`items.${index}.unitId`]} htmlFor={`recipe-item-unit-${index}`} label="単位" required><SelectInput {...fieldErrorProps(`items.${index}.unitId`, `recipe-item-unit-${index}`, errors)} id={`recipe-item-unit-${index}`} onChange={(event) => changeItem(index, "unitId", event.target.value)} value={item.unitId}><option value="">選択してください</option>{units.map((unit) => <option disabled={unit.status !== "ACTIVE" && unit.id !== item.unitId} key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}){unit.status === "INACTIVE" ? " [無効]" : ""}</option>)}</SelectInput></Field><Field error={errors[`items.${index}.quantity`]} htmlFor={`recipe-item-quantity-${index}`} label="数量" required><TextInput {...fieldErrorProps(`items.${index}.quantity`, `recipe-item-quantity-${index}`, errors)} id={`recipe-item-quantity-${index}`} inputMode="decimal" onChange={(event) => changeItem(index, "quantity", event.target.value)} value={item.quantity} /></Field><div className="flex items-end"><button className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={values.items.length === 1} onClick={() => removeItem(index)} type="button">削除</button></div></div>)}</div></section><div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : "下書きを保存"}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" href={cancelHref}>キャンセル</Link></div></form>;
}

function MastersGate({ children, masters }: Readonly<{ children(masters: { products: Product[]; units: Unit[] }): React.ReactNode; masters: { retry(): void; state: MastersState } }>) {
  if (masters.state.status === "loading") return <p className="mt-8 text-sm text-slate-700" role="status">商品と単位を読み込んでいます…</p>;
  if (masters.state.status === "error") return <LoadError message={masters.state.message} retry={masters.retry} />;
  return <>{children(masters.state)}</>;
}

function RecipeStatusBadge({ status }: Readonly<{ status: RecipeStatus }>) {
  const className = status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : status === "DRAFT" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${className}`}>{recipeStatusLabel(status)}</span>;
}

function ActionButton({ action, actionName, label, onClick, pendingLabel }: Readonly<{ action: RecipeAction; actionName: Exclude<RecipeAction, null>; label: string; onClick(): void; pendingLabel: string }>) {
  return <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={action !== null} onClick={onClick} type="button">{action === actionName ? pendingLabel : label}</button>;
}

function DetailItem({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) { return <div><dt className="font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-950">{value}</dd></div>; }

function LoadError({ message, retry }: Readonly<{ message: string; retry(): void }>) { return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-5"><p className="text-sm text-red-900" role="alert">{message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>; }

function RecipeNotFound() { return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">レシピが見つかりません</h1><p className="mt-3 text-sm text-slate-700">指定されたレシピは存在しないか、現在は参照できません。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/recipes">レシピ一覧へ戻る</Link></section>; }

function RecipeReadAccessRequired() { return <section className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950">参照権限がありません</h1><p className="mt-3 text-sm text-amber-900">レシピの閲覧にはマスター参照権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/products">マスターへ戻る</Link></section>; }
