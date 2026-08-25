"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api-client";
import {
  formatProductionTimestamp,
  initialProductionCreateValues,
  isActiveRecipeList,
  isPostedProductionResult,
  isProduction,
  productionCreatePayload,
  productionFormFromProduction,
  productionStatusLabel,
  productionUpdatePayload,
  validateActualQuantity,
  validateProductionCreate,
  validateProductionUpdate,
  type ActiveRecipe,
  type Production,
  type ProductionCreateValues,
  type ProductionFieldErrors,
  type ProductionFormValues,
  type ProductionStatus,
} from "@/lib/productions";
import { Field, FormError, SelectInput, TextArea, TextInput } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type ProductionState =
  | { status: "loading" }
  | { status: "ready"; production: Production }
  | { status: "not_found" }
  | { status: "error"; message: string };

type ActiveRecipesState =
  | { status: "loading" }
  | { status: "ready"; recipes: ActiveRecipe[] }
  | { status: "error"; message: string };

type LifecycleAction = "confirm" | "post" | null;

function productionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "生産情報を処理できませんでした。時間をおいて再試行してください。";
}

function handleProductionError(error: unknown, refreshAuthentication: () => void): "unauthorized" | "forbidden" | "other" {
  if (!(error instanceof ApiError)) return "other";
  if (error.kind === "unauthorized") return "unauthorized";
  if (error.kind === "forbidden") {
    // A 403 revokes only the attempted action. Refresh the in-memory permission
    // view, while preserving an already loaded detail page if read remains.
    refreshAuthentication();
    return "forbidden";
  }
  return "other";
}

async function requestProduction(api: ApiClient, productionId: string): Promise<Production> {
  const payload = await api.request<unknown>(`/productions/${encodeURIComponent(productionId)}`);
  if (!isProduction(payload)) throw new ApiError("server");
  return payload;
}

function useActiveRecipes(shouldLoad: boolean): { retry(): void; state: ActiveRecipesState } {
  const { api, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<ActiveRecipesState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!shouldLoad) return;
    let active = true;
    void api.request<unknown>("/recipes?status=ACTIVE&limit=100&offset=0").then((payload) => {
      if (!isActiveRecipeList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", recipes: payload });
    }).catch((error: unknown) => {
      if (!active) return;
      const kind = handleProductionError(error, refreshAuthentication);
      if (kind === "unauthorized") return;
      setState({ status: "error", message: productionErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey, shouldLoad]);

  return {
    state,
    retry: () => {
      setState({ status: "loading" });
      setRetryKey((current) => current + 1);
    },
  };
}

export function ProductionWorkspacePage() {
  const router = useRouter();
  const { permissions } = useOperationalApp();
  const [productionId, setProductionId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const canRead = permissions.has("production.read");
  const canCreate = permissions.has("production.write") && permissions.has("master.read");

  function openProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = productionId.trim();
    if (id.length === 0) {
      setLookupError("生産IDを入力してください。");
      return;
    }
    router.push(`/productions/${encodeURIComponent(id)}`);
  }

  if (!canRead) return <ProductionReadAccessRequired />;

  return (
    <section aria-labelledby="productions-title" className="max-w-3xl">
      <ProductionNavigation />
      <p className="text-sm font-medium text-blue-700">生産</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="productions-title">生産ワークスペース</h1>
      <p className="mt-3 text-sm text-slate-700">有効なレシピから生産下書きを作成し、確認後に計上します。生産一覧APIはないため、作成後の詳細画面または生産IDから既存の生産を開きます。</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <section aria-labelledby="production-create-card-title" className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950" id="production-create-card-title">新しい生産</h2>
          <p className="mt-2 text-sm text-slate-700">予定量は10進数文字列のまま送信します。材料消費、換算、原価、在庫への反映はサーバーが確定します。</p>
          {canCreate ? <Link className="mt-5 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions/new">生産を作成</Link> : <p className="mt-5 text-sm text-slate-600">作成には生産書込とマスター参照の権限が必要です。</p>}
        </section>
        <section aria-labelledby="production-open-card-title" className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950" id="production-open-card-title">既存の生産を開く</h2>
          <form className="mt-4" noValidate onSubmit={openProduction}>
            <Field error={lookupError ?? undefined} htmlFor="production-id" label="生産ID" required>
              <TextInput aria-describedby={lookupError === null ? undefined : "production-id-error"} id="production-id" onChange={(event) => { setProductionId(event.target.value); setLookupError(null); }} value={productionId} />
            </Field>
            <button className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" type="submit">詳細を開く</button>
          </form>
        </section>
      </div>
    </section>
  );
}

export function ProductionCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [values, setValues] = useState<ProductionCreateValues>(initialProductionCreateValues);
  const [errors, setErrors] = useState<ProductionFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { retry, state: recipesState } = useActiveRecipes(permissions.has("master.read"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProductionCreate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/productions", { method: "POST", body: productionCreatePayload(values) });
      if (!isProduction(created)) throw new ApiError("server");
      router.replace(`/productions/${encodeURIComponent(created.id)}`);
    } catch (error: unknown) {
      if (handleProductionError(error, refreshAuthentication) !== "unauthorized") setFormError(productionErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("production.write")) return <ProductionWriteAccessRequired backHref="/productions" />;
  if (!permissions.has("master.read")) return <RecipeReadAccessRequired backHref="/productions" />;

  return (
    <section aria-labelledby="production-create-title" className="max-w-5xl">
      <ProductionNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="production-create-title">生産を新規作成</h1>
      <p className="mt-2 text-sm text-slate-700">有効なレシピだけを選択できます。選択したレシピの出力とBOMは確認用表示です。予定量からの材料・在庫・原価計算はブラウザーでは行いません。</p>
      <ActiveRecipesGate retry={retry} state={recipesState}>
        {(recipes) => <ProductionCreateForm errors={errors} formError={formError} isSubmitting={isSubmitting} onChange={setValues} onSubmit={submit} recipes={recipes} values={values} />}
      </ActiveRecipesGate>
    </section>
  );
}

export function ProductionEditPage({ productionId }: Readonly<{ productionId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<ProductionState>({ status: "loading" });
  const [values, setValues] = useState<ProductionFormValues>({ productionDate: "", plannedQuantity: "", note: "" });
  const [errors, setErrors] = useState<ProductionFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    void requestProduction(api, productionId).then((production) => {
      if (!active) return;
      setState({ status: "ready", production });
      setValues(productionFormFromProduction(production));
    }).catch((error: unknown) => {
      if (!active) return;
      const kind = handleProductionError(error, refreshAuthentication);
      if (kind === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: productionErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, productionId, refreshAuthentication, retryKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProductionUpdate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/productions/${encodeURIComponent(productionId)}`, { method: "PATCH", body: productionUpdatePayload(values) });
      if (!isProduction(updated)) throw new ApiError("server");
      router.replace(`/productions/${encodeURIComponent(updated.id)}`);
    } catch (error: unknown) {
      if (handleProductionError(error, refreshAuthentication) !== "unauthorized") setFormError(productionErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("production.write")) return <ProductionWriteAccessRequired backHref={`/productions/${encodeURIComponent(productionId)}`} />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">生産情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <ProductionNotFound />;
  if (state.status === "error") return <ProductionLoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;
  if (state.production.status !== "DRAFT") return <ProductionNoLongerEditable production={state.production} />;

  return (
    <section aria-labelledby="production-edit-title" className="max-w-3xl">
      <ProductionNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="production-edit-title">生産下書きを編集</h1>
      <p className="mt-2 text-sm text-slate-700">下書きの生産日、予定生産量、メモだけを編集できます。レシピ、出力、スナップショット、状態は送信しません。</p>
      <ProductionEditForm errors={errors} formError={formError} isSubmitting={isSubmitting} onChange={setValues} onSubmit={submit} values={values} />
    </section>
  );
}

export function ProductionDetailPage({ productionId }: Readonly<{ productionId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<ProductionState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [action, setAction] = useState<LifecycleAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actualQuantity, setActualQuantity] = useState("");
  const [actualQuantityError, setActualQuantityError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);

  useEffect(() => {
    let active = true;
    void requestProduction(api, productionId).then((production) => {
      if (!active) return;
      setState({ status: "ready", production });
      setActualQuantity(production.actualQuantity ?? production.plannedQuantity);
      setActionError(null);
      setActualQuantityError(null);
      setReloadRequired(false);
    }).catch((error: unknown) => {
      if (!active) return;
      const kind = handleProductionError(error, refreshAuthentication);
      if (kind === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: productionErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, productionId, refreshAuthentication, retryKey]);

  function reloadLatest() {
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  function recordActionFailure(error: unknown) {
    const kind = handleProductionError(error, refreshAuthentication);
    if (kind === "unauthorized") return;
    setActionError(productionErrorMessage(error));
    if (error instanceof ApiError && error.kind === "conflict") setReloadRequired(true);
  }

  async function confirm() {
    if (action !== null || reloadRequired || state.status !== "ready" || state.production.status !== "DRAFT") return;
    setAction("confirm");
    setActionError(null);
    try {
      const confirmed = await api.request<unknown>(`/productions/${encodeURIComponent(productionId)}/confirm`, { method: "POST" });
      if (!isProduction(confirmed)) throw new ApiError("server");
      // Confirm returns the complete current Production. It is the source of
      // truth here; do not issue a success-follow-up GET.
      setState({ status: "ready", production: confirmed });
    } catch (error: unknown) {
      recordActionFailure(error);
    } finally {
      setAction(null);
    }
  }

  async function post() {
    if (action !== null || reloadRequired || state.status !== "ready" || state.production.status !== "CONFIRMED") return;
    const nextActualQuantityError = validateActualQuantity(actualQuantity);
    setActualQuantityError(nextActualQuantityError ?? null);
    setActionError(null);
    if (nextActualQuantityError !== undefined) return;
    const production = state.production;
    setAction("post");
    try {
      const posted = await api.request<unknown>(`/productions/${encodeURIComponent(productionId)}/post`, { method: "POST", body: { actualQuantity: actualQuantity.trim() } });
      if (!isPostedProductionResult(posted, productionId)) throw new ApiError("server");
      // POST intentionally returns only lifecycle fields. Merge its validated
      // authority into the already-rendered immutable detail, without a GET
      // that could fail after the database transaction has committed.
      setState({ status: "ready", production: { ...production, status: "POSTED", postedAt: posted.postedAt, actualQuantity: posted.actualQuantity } });
    } catch (error: unknown) {
      recordActionFailure(error);
    } finally {
      setAction(null);
    }
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">生産情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <ProductionNotFound />;
  if (state.status === "error") return <ProductionLoadError message={state.message} retry={reloadLatest} />;

  const { production } = state;
  const canEdit = production.status === "DRAFT" && permissions.has("production.write") && !reloadRequired;
  const canConfirm = production.status === "DRAFT" && permissions.has("production.confirm") && !reloadRequired;
  const canPost = production.status === "CONFIRMED" && permissions.has("production.post") && !reloadRequired;

  return (
    <section aria-labelledby="production-detail-title" className="max-w-6xl">
      <ProductionNavigation />
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions">← 生産ワークスペース</Link>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="font-mono text-xs text-slate-600">{production.id}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="production-detail-title">生産詳細</h1></div>
          <ProductionStatusBadge status={production.status} />
        </div>
        <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">下書きだけを編集・確認できます。確認済みだけを計上できます。計上済み・取消済みは読み取り専用です。材料消費、換算、原価、在庫更新、履歴のexactly-onceはサーバーとデータベースの責務です。</p>
        {reloadRequired ? <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-950" role="alert">状態が更新されています。操作を再実行せず、最新状態を確認してください。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700" onClick={reloadLatest} type="button">最新状態を再読み込み</button></section> : <>
          <div className="mt-5 flex flex-wrap gap-3">
            {canEdit && <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/productions/${encodeURIComponent(production.id)}/edit`}>下書きを編集</Link>}
            {canConfirm && <button className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700" disabled={action !== null} onClick={() => void confirm()} type="button">{action === "confirm" ? "確認しています…" : "生産を確認"}</button>}
          </div>
          {canPost && <section aria-labelledby="production-post-title" className="mt-5 max-w-md rounded-lg border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold text-slate-950" id="production-post-title">生産を計上</h2><p className="mt-1 text-sm text-slate-700">実績生産量は10進数文字列で送信します。計上はサーバーのtransactionが一度だけ実行します。</p><Field error={actualQuantityError ?? undefined} htmlFor="production-actual-quantity" label="実績生産量" required><TextInput aria-describedby={actualQuantityError === null ? undefined : "production-actual-quantity-error"} id="production-actual-quantity" inputMode="decimal" onChange={(event) => { setActualQuantity(event.target.value); setActualQuantityError(null); }} value={actualQuantity} /></Field><button className="mt-4 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" disabled={action !== null} onClick={() => void post()} type="button">{action === "post" ? "計上しています…" : "生産を計上"}</button></section>}
        </>}
        <FormError message={actionError} />
        <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="生産日" value={production.productionDate.slice(0, 10)} />
          <DetailItem label="予定生産量" value={production.plannedQuantity} />
          <DetailItem label="実績生産量（サーバー確定）" value={production.actualQuantity ?? "—"} />
          <DetailItem label="計上日時（サーバー確定）" value={formatProductionTimestamp(production.postedAt)} />
          <DetailItem label="メモ" value={production.note ?? "—"} />
          <DetailItem label="作成日時" value={formatProductionTimestamp(production.createdAt)} />
        </dl>
        <section aria-labelledby="production-recipe-title" className="mt-8 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold text-slate-950" id="production-recipe-title">レシピ系譜と出力スナップショット</h2><p className="mt-1 text-sm text-slate-700">現在のレシピ状態に関係なく、作成時に固定された系譜・出力を表示します。</p><dl className="mt-4 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3"><DetailItem label="レシピID" value={production.recipe.id} /><DetailItem label="ルートレシピID" value={production.recipe.rootRecipeId} /><DetailItem label="リビジョン" value={String(production.recipe.revision)} /><DetailItem label="出力商品ID" value={production.output.productId} /><DetailItem label="レシピ歩留まり" value={production.output.yieldQuantity} /><DetailItem label="出力単位ID" value={production.output.unitId} /><DetailItem label="出力換算係数（スナップショット）" value={production.output.conversionFactor} /></dl></section>
        <section aria-labelledby="production-consumptions-title" className="mt-8 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold text-slate-950" id="production-consumptions-title">材料消費スナップショット</h2><p className="mt-1 text-sm text-slate-700">表示値はサーバーが保持する作成時点のスナップショットです。ブラウザーでは予定量への展開や在庫・原価計算を行いません。</p><div className="mt-4 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">行</th><th className="px-4 py-3 font-semibold">商品ID</th><th className="px-4 py-3 text-right font-semibold">レシピ量</th><th className="px-4 py-3 font-semibold">レシピ単位ID</th><th className="px-4 py-3 text-right font-semibold">在庫量</th><th className="px-4 py-3 font-semibold">在庫単位ID</th><th className="px-4 py-3 text-right font-semibold">換算係数</th><th className="px-4 py-3 text-right font-semibold">計上原価</th></tr></thead><tbody className="divide-y divide-slate-100">{production.consumptions.map((consumption) => <tr key={consumption.id}><td className="px-4 py-3 text-slate-950">{consumption.lineNumber}</td><td className="break-all px-4 py-3 font-mono text-xs text-slate-950">{consumption.productId}</td><td className="px-4 py-3 text-right text-slate-950">{consumption.recipeQuantitySnapshot}</td><td className="break-all px-4 py-3 font-mono text-xs text-slate-950">{consumption.recipeUnitId}</td><td className="px-4 py-3 text-right text-slate-950">{consumption.inventoryQuantity}</td><td className="break-all px-4 py-3 font-mono text-xs text-slate-950">{consumption.inventoryUnitId}</td><td className="px-4 py-3 text-right text-slate-950">{consumption.conversionFactorSnapshot}</td><td className="px-4 py-3 text-right text-slate-950">{consumption.amountSnapshot} {consumption.currency}</td></tr>)}</tbody></table></div></section>
      </div>
    </section>
  );
}

function ProductionCreateForm({ errors, formError, isSubmitting, onChange, onSubmit, recipes, values }: Readonly<{ errors: ProductionFieldErrors; formError: string | null; isSubmitting: boolean; onChange(next: ProductionCreateValues): void; onSubmit(event: FormEvent<HTMLFormElement>): void; recipes: ActiveRecipe[]; values: ProductionCreateValues }>) {
  const selectedRecipe = recipes.find((recipe) => recipe.id === values.recipeId);
  return <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={onSubmit}><FormError message={formError} /><Field error={errors.recipeId} htmlFor="production-recipe" label="有効なレシピ" required><SelectInput aria-describedby={errors.recipeId === undefined ? undefined : "production-recipe-error"} aria-invalid={errors.recipeId === undefined ? undefined : true} id="production-recipe" onChange={(event) => onChange({ ...values, recipeId: event.target.value })} required value={values.recipeId}><option value="">選択してください</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name} — revision {recipe.revision}</option>)}</SelectInput></Field>{selectedRecipe !== undefined && <RecipePreview recipe={selectedRecipe} />}<ProductionFields errors={errors} onChange={(next) => onChange({ ...values, ...next })} values={values} /><div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "作成しています…" : "下書きを作成"}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions">キャンセル</Link></div></form>;
}

function RecipePreview({ recipe }: Readonly<{ recipe: ActiveRecipe }>) {
  return <section aria-labelledby="recipe-preview-title" className="rounded-lg border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold text-slate-950" id="recipe-preview-title">選択した有効レシピ</h2><dl className="mt-3 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2"><DetailItem label="レシピ系譜" value={`${recipe.rootRecipeId} / revision ${recipe.revision}`} /><DetailItem label="出力商品ID" value={recipe.outputProductId} /><DetailItem label="レシピ歩留まり" value={recipe.yieldQuantity} /><DetailItem label="出力単位ID" value={recipe.yieldUnitId} /></dl><h3 className="mt-5 font-medium text-slate-900">BOM</h3><ul className="mt-2 space-y-2 text-sm text-slate-700">{[...recipe.items].sort((left, right) => left.sortOrder - right.sortOrder).map((item) => <li className="rounded border border-slate-200 bg-white px-3 py-2" key={item.id}>商品ID: <span className="font-mono text-xs">{item.productId}</span> ／ 数量: {item.quantity} ／ 単位ID: <span className="font-mono text-xs">{item.unitId}</span></li>)}</ul></section>;
}

function ProductionEditForm({ errors, formError, isSubmitting, onChange, onSubmit, values }: Readonly<{ errors: ProductionFieldErrors; formError: string | null; isSubmitting: boolean; onChange(next: ProductionFormValues): void; onSubmit(event: FormEvent<HTMLFormElement>): void; values: ProductionFormValues }>) {
  return <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={onSubmit}><FormError message={formError} /><ProductionFields errors={errors} onChange={onChange} values={values} /><div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : "下書きを保存"}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions">キャンセル</Link></div></form>;
}

function ProductionFields({ errors, onChange, values }: Readonly<{ errors: ProductionFieldErrors; onChange(next: ProductionFormValues): void; values: ProductionFormValues }>) {
  return <div className="grid gap-5 sm:grid-cols-2"><Field error={errors.productionDate} htmlFor="production-date" label="生産日" required><TextInput aria-describedby={errors.productionDate === undefined ? undefined : "production-date-error"} aria-invalid={errors.productionDate === undefined ? undefined : true} id="production-date" onChange={(event) => onChange({ ...values, productionDate: event.target.value })} required type="date" value={values.productionDate} /></Field><Field error={errors.plannedQuantity} htmlFor="production-planned-quantity" label="予定生産量" required><TextInput aria-describedby={errors.plannedQuantity === undefined ? undefined : "production-planned-quantity-error"} aria-invalid={errors.plannedQuantity === undefined ? undefined : true} id="production-planned-quantity" inputMode="decimal" onChange={(event) => onChange({ ...values, plannedQuantity: event.target.value })} required value={values.plannedQuantity} /></Field><div className="sm:col-span-2"><Field htmlFor="production-note" label="メモ"><TextArea id="production-note" maxLength={1000} onChange={(event) => onChange({ ...values, note: event.target.value })} rows={3} value={values.note} /></Field></div></div>;
}

function ActiveRecipesGate({ children, retry, state }: Readonly<{ children: (recipes: ActiveRecipe[]) => React.ReactNode; retry(): void; state: ActiveRecipesState }>) {
  if (state.status === "loading") return <p className="mt-8 text-sm text-slate-700" role="status">有効なレシピを読み込んでいます…</p>;
  if (state.status === "error") return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>;
  if (state.recipes.length === 0) return <section className="mt-8 max-w-xl rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold text-slate-950">選択できる有効レシピがありません</h2><p className="mt-3 text-sm text-slate-700">生産下書きは、有効で材料を持つレシピから作成できます。</p></section>;
  return <>{children(state.recipes)}</>;
}

function ProductionNavigation() {
  const { permissions } = useOperationalApp();
  const canCreate = permissions.has("production.write") && permissions.has("master.read");
  return <nav aria-label="生産" className="mb-6 flex flex-wrap gap-4 text-sm"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions">生産ワークスペース</Link>{canCreate && <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/productions/new">生産を作成</Link>}</nav>;
}

function ProductionStatusBadge({ status }: Readonly<{ status: ProductionStatus }>) {
  const className = status === "POSTED" ? "bg-emerald-100 text-emerald-800" : status === "CONFIRMED" ? "bg-amber-100 text-amber-900" : status === "CANCELLED" ? "bg-slate-300 text-slate-800" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${className}`}>{productionStatusLabel(status)}</span>;
}

function DetailItem({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt className="font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-950">{value}</dd></div>; }
function ProductionNotFound() { return <section aria-labelledby="production-not-found-title" className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950" id="production-not-found-title">生産が見つかりません</h1><p className="mt-3 text-sm text-slate-700">指定された生産は存在しないか、現在は参照できません。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/productions">生産ワークスペースへ戻る</Link></section>; }
function ProductionLoadError({ message, retry }: Readonly<{ message: string; retry(): void }>) { return <section aria-labelledby="production-load-error-title" className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-semibold text-red-950" id="production-load-error-title">生産情報を表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>; }
function ProductionReadAccessRequired() { return <section aria-labelledby="production-read-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="production-read-required-title">生産参照権限がありません</h1><p className="mt-3 text-sm text-amber-900">生産ワークスペースと既存生産の表示には生産参照権限が必要です。</p></section>; }
function ProductionWriteAccessRequired({ backHref }: Readonly<{ backHref: string }>) { return <section aria-labelledby="production-write-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="production-write-required-title">生産書込権限がありません</h1><p className="mt-3 text-sm text-amber-900">生産下書きの作成・編集には生産書込権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>生産詳細へ戻る</Link></section>; }
function RecipeReadAccessRequired({ backHref }: Readonly<{ backHref: string }>) { return <section aria-labelledby="recipe-read-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="recipe-read-required-title">レシピ参照権限がありません</h1><p className="mt-3 text-sm text-amber-900">有効なレシピを安全に選択するためにマスター参照権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>生産ワークスペースへ戻る</Link></section>; }
function ProductionNoLongerEditable({ production }: Readonly<{ production: Production }>) { return <section aria-labelledby="production-not-editable-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="production-not-editable-title">この生産は編集できません</h1><p className="mt-3 text-sm text-amber-900">現在の状態は「{productionStatusLabel(production.status)}」です。下書きだけが編集できます。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/productions/${encodeURIComponent(production.id)}`}>生産詳細へ戻る</Link></section>; }
