"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api-client";
import { isUnitList, type Unit } from "@/lib/master-data";
import { isProductList, type Product } from "@/lib/products";
import {
  emptyStocktakeForm,
  emptyStocktakeLine,
  formatStocktakeTimestamp,
  isStocktake,
  stocktakeFormFromStocktake,
  stocktakePayload,
  stocktakeStatusLabel,
  validateStocktakeForm,
  type Stocktake,
  type StocktakeFieldErrors,
  type StocktakeFormValues,
  type StocktakeLineFormValues,
  type StocktakeStatus,
} from "@/lib/stocktakes";
import { Field, FormError, SelectInput, TextArea, TextInput } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type StocktakeMasters = {
  products: Product[];
  units: Unit[];
};

type MastersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; masters: StocktakeMasters }
  | { status: "error"; message: string };

type StocktakeState =
  | { status: "loading" }
  | { status: "ready"; stocktake: Stocktake }
  | { status: "not_found" }
  | { status: "error"; message: string };

function protectedStocktakeError(error: unknown, refreshAuthentication: () => void): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === "unauthorized") return true;
  if (error.kind !== "forbidden") return false;
  // A 403 is a permission failure, not a logout. Reboot the in-memory
  // permission view so a revoked permission cannot leave stale controls live.
  refreshAuthentication();
  window.location.assign("/forbidden");
  return true;
}

function stocktakeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "棚卸情報を処理できませんでした。時間をおいて再試行してください。";
}

function useStocktakeMasters(shouldLoad: boolean): { retry(): void; state: MastersState } {
  const { api, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<MastersState>({ status: shouldLoad ? "loading" : "idle" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!shouldLoad) return;

    let active = true;
    void Promise.all([
      api.request<unknown>("/products"),
      api.request<unknown>("/units"),
    ]).then(([products, units]) => {
      if (!isProductList(products) || !isUnitList(units)) throw new ApiError("server");
      if (active) setState({ status: "ready", masters: { products, units } });
    }).catch((error: unknown) => {
      if (!active || protectedStocktakeError(error, refreshAuthentication)) return;
      setState({ status: "error", message: stocktakeErrorMessage(error) });
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

async function requestStocktake(api: ApiClient, stocktakeId: string): Promise<Stocktake> {
  const payload = await api.request<unknown>(`/stocktakes/${encodeURIComponent(stocktakeId)}`);
  if (!isStocktake(payload)) throw new ApiError("server");
  return payload;
}

function isPostedStocktakeResult(value: unknown, stocktakeId: string): value is { id: string; status: "POSTED"; completedAt: string } {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return result.id === stocktakeId && result.status === "POSTED" && typeof result.completedAt === "string";
}

export function StocktakeWorkspacePage() {
  const router = useRouter();
  const { permissions } = useOperationalApp();
  const [stocktakeId, setStocktakeId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const canRead = permissions.has("stocktake.read");
  const canCreate = permissions.has("stocktake.write") && canRead && permissions.has("master.read");

  function openStocktake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = stocktakeId.trim();
    if (id.length === 0) {
      setLookupError("棚卸IDを入力してください。");
      return;
    }
    router.push(`/stocktakes/${encodeURIComponent(id)}`);
  }

  return (
    <section aria-labelledby="stocktakes-title" className="max-w-3xl">
      <StocktakeNavigation />
      <p className="text-sm font-medium text-blue-700">棚卸</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="stocktakes-title">棚卸ワークスペース</h1>
      <p className="mt-3 text-sm text-slate-700">棚卸を下書きで登録し、確認後に計上します。既存APIには棚卸一覧がないため、登録後の詳細画面または棚卸IDから既存の棚卸を開きます。</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="stocktake-create-card-title">
          <h2 className="text-xl font-bold text-slate-950" id="stocktake-create-card-title">新しい棚卸</h2>
          <p className="mt-2 text-sm text-slate-700">商品と実棚数量を入力して下書きを作成します。在庫差と在庫への反映はサーバーが処理します。</p>
          {canCreate ? (
            <Link className="mt-5 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/stocktakes/new">棚卸を作成</Link>
          ) : (
            <p className="mt-5 text-sm text-slate-600">作成には棚卸参照・書込とマスター参照の権限が必要です。</p>
          )}
        </section>
        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="stocktake-open-card-title">
          <h2 className="text-xl font-bold text-slate-950" id="stocktake-open-card-title">既存の棚卸を開く</h2>
          {canRead ? (
            <form className="mt-4" noValidate onSubmit={openStocktake}>
              <Field error={lookupError ?? undefined} htmlFor="stocktake-id" label="棚卸ID" required>
                <TextInput aria-describedby={lookupError === null ? undefined : "stocktake-id-error"} id="stocktake-id" onChange={(event) => { setStocktakeId(event.target.value); setLookupError(null); }} value={stocktakeId} />
              </Field>
              <button className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" type="submit">詳細を開く</button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-slate-600">既存棚卸の表示には棚卸参照権限が必要です。</p>
          )}
        </section>
      </div>
    </section>
  );
}

export function StocktakeCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const nextLine = useRef(1);
  const [values, setValues] = useState<StocktakeFormValues>(() => emptyStocktakeForm("stocktake-line-1"));
  const [errors, setErrors] = useState<StocktakeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { retry, state: mastersState } = useStocktakeMasters(permissions.has("master.read"));

  function addLine() {
    const rowKey = `stocktake-line-${nextLine.current += 1}`;
    setValues((current) => ({ ...current, items: [...current.items, emptyStocktakeLine(rowKey)] }));
  }

  function removeLine(rowKey: string) {
    setValues((current) => ({ ...current, items: current.items.filter((item) => item.rowKey !== rowKey) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStocktakeForm(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/stocktakes", { method: "POST", body: stocktakePayload(values) });
      if (!isStocktake(created)) throw new ApiError("server");
      router.replace(`/stocktakes/${encodeURIComponent(created.id)}`);
    } catch (error: unknown) {
      if (!protectedStocktakeError(error, refreshAuthentication)) setFormError(stocktakeErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("stocktake.write") || !permissions.has("stocktake.read")) return <StocktakeWriteAccessRequired backHref="/stocktakes" />;
  if (!permissions.has("master.read")) return <MasterReadAccessRequired backHref="/stocktakes" />;

  return (
    <section aria-labelledby="stocktake-create-title" className="max-w-5xl">
      <StocktakeNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="stocktake-create-title">棚卸を新規作成</h1>
      <p className="mt-2 text-sm text-slate-700">実棚数量は入力した10進数文字列のまま送信されます。差異・在庫更新・履歴記録はサーバーのtransactionが行います。</p>
      <MastersGate retry={retry} state={mastersState}>
        {(masters) => (
          <StocktakeForm
            errors={errors}
            formError={formError}
            isSubmitting={isSubmitting}
            masters={masters}
            onAddLine={addLine}
            onChange={setValues}
            onRemoveLine={removeLine}
            onSubmit={submit}
            submitLabel="下書きを作成"
            values={values}
          />
        )}
      </MastersGate>
    </section>
  );
}

export function StocktakeEditPage({ stocktakeId }: Readonly<{ stocktakeId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const nextLine = useRef(1);
  const [state, setState] = useState<StocktakeState>({ status: "loading" });
  const [values, setValues] = useState<StocktakeFormValues>(() => emptyStocktakeForm("stocktake-line-1"));
  const [errors, setErrors] = useState<StocktakeFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const { retry: retryMasters, state: mastersState } = useStocktakeMasters(permissions.has("master.read"));

  useEffect(() => {
    let active = true;
    void requestStocktake(api, stocktakeId).then((stocktake) => {
      if (!active) return;
      setState({ status: "ready", stocktake });
      setValues(stocktakeFormFromStocktake(stocktake));
      nextLine.current = stocktake.items.length;
    }).catch((error: unknown) => {
      if (!active || protectedStocktakeError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: stocktakeErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey, stocktakeId]);

  function addLine() {
    const rowKey = `stocktake-line-${nextLine.current += 1}`;
    setValues((current) => ({ ...current, items: [...current.items, emptyStocktakeLine(rowKey)] }));
  }

  function removeLine(rowKey: string) {
    setValues((current) => ({ ...current, items: current.items.filter((item) => item.rowKey !== rowKey) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStocktakeForm(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/stocktakes/${encodeURIComponent(stocktakeId)}`, { method: "PATCH", body: stocktakePayload(values) });
      if (!isStocktake(updated)) throw new ApiError("server");
      router.replace(`/stocktakes/${encodeURIComponent(updated.id)}`);
    } catch (error: unknown) {
      if (!protectedStocktakeError(error, refreshAuthentication)) setFormError(stocktakeErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("stocktake.write")) return <StocktakeWriteAccessRequired backHref={`/stocktakes/${encodeURIComponent(stocktakeId)}`} />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">棚卸情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <StocktakeNotFound />;
  if (state.status === "error") return <StocktakeLoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;
  if (state.stocktake.status !== "DRAFT") return <StocktakeNoLongerEditable stocktake={state.stocktake} />;
  if (!permissions.has("master.read")) return <MasterReadAccessRequired backHref={`/stocktakes/${encodeURIComponent(stocktakeId)}`} />;

  return (
    <section aria-labelledby="stocktake-edit-title" className="max-w-5xl">
      <StocktakeNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="stocktake-edit-title">棚卸下書きを編集</h1>
      <p className="mt-2 text-sm text-slate-700">下書きのみ編集できます。保存時にサーバーが商品・在庫単位・現在庫スナップショットを判定します。</p>
      <MastersGate retry={retryMasters} state={mastersState}>
        {(masters) => (
          <StocktakeForm
            errors={errors}
            formError={formError}
            isSubmitting={isSubmitting}
            masters={masters}
            onAddLine={addLine}
            onChange={setValues}
            onRemoveLine={removeLine}
            onSubmit={submit}
            submitLabel="下書きを保存"
            values={values}
          />
        )}
      </MastersGate>
    </section>
  );
}

export function StocktakeDetailPage({ stocktakeId }: Readonly<{ stocktakeId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<StocktakeState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [action, setAction] = useState<"confirm" | "post" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { state: mastersState } = useStocktakeMasters(permissions.has("master.read"));

  useEffect(() => {
    let active = true;
    void requestStocktake(api, stocktakeId).then((stocktake) => {
      if (active) setState({ status: "ready", stocktake });
    }).catch((error: unknown) => {
      if (!active || protectedStocktakeError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: stocktakeErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey, stocktakeId]);

  async function confirm() {
    if (action !== null) return;
    setAction("confirm");
    setActionError(null);
    try {
      const latest = await requestStocktake(api, stocktakeId);
      setState({ status: "ready", stocktake: latest });
      if (latest.status !== "DRAFT") return;
      const confirmed = await api.request<unknown>(`/stocktakes/${encodeURIComponent(stocktakeId)}/confirm`, { method: "POST" });
      if (!isStocktake(confirmed)) throw new ApiError("server");
      setState({ status: "ready", stocktake: confirmed });
    } catch (error: unknown) {
      if (!protectedStocktakeError(error, refreshAuthentication)) setActionError(stocktakeErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function post() {
    if (action !== null) return;
    setAction("post");
    setActionError(null);
    try {
      const latest = await requestStocktake(api, stocktakeId);
      setState({ status: "ready", stocktake: latest });
      if (latest.status !== "CONFIRMED") return;
      const posted = await api.request<unknown>(`/stocktakes/${encodeURIComponent(stocktakeId)}/post`, { method: "POST" });
      if (!isPostedStocktakeResult(posted, stocktakeId)) throw new ApiError("server");
      // POST is the lifecycle authority. Avoid a follow-up GET: a rate limit
      // after a successful post must not make the UI look retryable.
      setState({ status: "ready", stocktake: { ...latest, status: "POSTED", completedAt: posted.completedAt } });
    } catch (error: unknown) {
      if (!protectedStocktakeError(error, refreshAuthentication)) setActionError(stocktakeErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">棚卸情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <StocktakeNotFound />;
  if (state.status === "error") return <StocktakeLoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;

  const { stocktake } = state;
  const masters = mastersState.status === "ready" ? mastersState.masters : null;
  return (
    <section aria-labelledby="stocktake-detail-title" className="max-w-5xl">
      <StocktakeNavigation />
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/stocktakes">← 棚卸ワークスペース</Link>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-slate-600">{stocktake.id}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="stocktake-detail-title">棚卸詳細</h1>
          </div>
          <StocktakeStatusBadge status={stocktake.status} />
        </div>
        <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">下書きは編集できます。確認後は編集できません。確認済みのみを計上でき、計上済み・取消済みは読み取り専用です。差異計算、在庫更新、履歴記録はサーバーが一度だけ実行します。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {stocktake.status === "DRAFT" && permissions.has("stocktake.write") && permissions.has("master.read") && (
            <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/stocktakes/${encodeURIComponent(stocktake.id)}/edit`}>下書きを編集</Link>
          )}
          {stocktake.status === "DRAFT" && permissions.has("stocktake.confirm") && (
            <button className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700" disabled={action !== null} onClick={() => void confirm()} type="button">{action === "confirm" ? "確認しています…" : "棚卸を確認"}</button>
          )}
          {stocktake.status === "CONFIRMED" && permissions.has("stocktake.post") && (
            <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" disabled={action !== null} onClick={() => void post()} type="button">{action === "post" ? "計上しています…" : "棚卸を計上"}</button>
          )}
        </div>
        <FormError message={actionError} />
        <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
          <DetailItem label="メモ" value={stocktake.note ?? "—"} />
          <DetailItem label="開始日時" value={formatStocktakeTimestamp(stocktake.startedAt)} />
          <DetailItem label="完了日時" value={formatStocktakeTimestamp(stocktake.completedAt)} />
          <DetailItem label="最終更新" value={formatStocktakeTimestamp(stocktake.updatedAt)} />
        </dl>
        <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">商品</th><th className="px-4 py-3 font-semibold">在庫単位</th><th className="px-4 py-3 text-right font-semibold">帳簿数量（保存時点）</th><th className="px-4 py-3 text-right font-semibold">実棚数量</th><th className="px-4 py-3 text-right font-semibold">差異（サーバー計算）</th><th className="px-4 py-3 font-semibold">行メモ</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {stocktake.items.map((item) => <tr key={item.id}>
                <td className="px-4 py-3 text-slate-950"><MasterReference fallbackId={item.productId} kind="product" masters={masters} /></td>
                <td className="px-4 py-3 text-slate-950"><MasterReference fallbackId={item.inventoryUnitId} kind="unit" masters={masters} /></td>
                <td className="px-4 py-3 text-right text-slate-950">{item.systemQuantitySnapshot ?? "—"}</td>
                <td className="px-4 py-3 text-right text-slate-950">{item.countedQuantity ?? "未入力"}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-950">{item.differenceQuantity ?? "—"}</td>
                <td className="px-4 py-3 text-slate-950">{item.note ?? "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StocktakeForm({ errors, formError, isSubmitting, masters, onAddLine, onChange, onRemoveLine, onSubmit, submitLabel, values }: Readonly<{
  errors: StocktakeFieldErrors;
  formError: string | null;
  isSubmitting: boolean;
  masters: StocktakeMasters;
  onAddLine(): void;
  onChange(next: StocktakeFormValues): void;
  onRemoveLine(rowKey: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  submitLabel: string;
  values: StocktakeFormValues;
}>) {
  function changeHeader(value: string) {
    onChange({ ...values, note: value });
  }

  function changeLine(rowKey: string, field: Exclude<keyof StocktakeLineFormValues, "rowKey">, value: string) {
    onChange({
      ...values,
      items: values.items.map((item) => item.rowKey === rowKey ? { ...item, [field]: value } : item),
    });
  }

  return (
    <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={onSubmit}>
      <FormError message={formError} />
      <Field htmlFor="stocktake-note" label="メモ"><TextArea id="stocktake-note" maxLength={1000} onChange={(event) => changeHeader(event.target.value)} rows={3} value={values.note} /></Field>
      <section aria-labelledby="stocktake-items-title" className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950" id="stocktake-items-title">棚卸明細</h2><p className="mt-1 text-sm text-slate-700">実棚数量は空欄のまま下書き保存できます。差異と在庫単位はサーバーが確定します。</p></div><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={onAddLine} type="button">明細を追加</button></div>
        {errors.items !== undefined && <p className="mt-3 text-sm text-red-800" role="alert">{errors.items}</p>}
        <div className="mt-5 space-y-5">{values.items.map((item, index) => <StocktakeLineEditor error={errors} index={index} item={item} key={item.rowKey} masters={masters} onChange={changeLine} onRemove={onRemoveLine} />)}</div>
      </section>
      <div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : submitLabel}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/stocktakes">キャンセル</Link></div>
    </form>
  );
}

function StocktakeLineEditor({ error, index, item, masters, onChange, onRemove }: Readonly<{
  error: StocktakeFieldErrors;
  index: number;
  item: StocktakeLineFormValues;
  masters: StocktakeMasters;
  onChange(rowKey: string, field: Exclude<keyof StocktakeLineFormValues, "rowKey">, value: string): void;
  onRemove(rowKey: string): void;
}>) {
  const productKnown = masters.products.some((product) => product.id === item.productId);
  const field = (name: string) => error[`items.${item.rowKey}.${name}`];
  const inputId = (name: string) => `stocktake-line-${index + 1}-${name}`;

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">明細 {index + 1}</legend>
      <div className="grid gap-5 md:grid-cols-3">
        <Field error={field("productId")} htmlFor={inputId("product")} label="商品" required>
          <SelectInput aria-invalid={field("productId") === undefined ? undefined : true} id={inputId("product")} onChange={(event) => onChange(item.rowKey, "productId", event.target.value)} required value={item.productId}>
            <option value="">選択してください</option>
            {item.productId.length > 0 && !productKnown && <option disabled value={item.productId}>利用できない商品（{item.productId}）</option>}
            {masters.products.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.name}{product.status === "INACTIVE" ? " [無効]" : ""}</option>)}
          </SelectInput>
        </Field>
        <Field error={field("countedQuantity")} htmlFor={inputId("counted-quantity")} label="実棚数量">
          <TextInput aria-invalid={field("countedQuantity") === undefined ? undefined : true} id={inputId("counted-quantity")} inputMode="decimal" onChange={(event) => onChange(item.rowKey, "countedQuantity", event.target.value)} value={item.countedQuantity} />
        </Field>
        <Field htmlFor={inputId("note")} label="行メモ">
          <TextInput id={inputId("note")} maxLength={1000} onChange={(event) => onChange(item.rowKey, "note", event.target.value)} value={item.note} />
        </Field>
        <div className="flex items-end"><button className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" onClick={() => onRemove(item.rowKey)} type="button">この明細を削除</button></div>
      </div>
    </fieldset>
  );
}

function MastersGate({ children, retry, state }: Readonly<{ children: (masters: StocktakeMasters) => React.ReactNode; retry(): void; state: MastersState }>) {
  if (state.status === "loading" || state.status === "idle") return <p className="mt-8 text-sm text-slate-700" role="status">商品・単位を読み込んでいます…</p>;
  if (state.status === "error") return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>;
  return <>{children(state.masters)}</>;
}

function StocktakeNavigation() {
  return <nav aria-label="棚卸" className="mb-6 flex flex-wrap gap-4 text-sm"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/stocktakes">棚卸ワークスペース</Link><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/stocktakes/new">棚卸を作成</Link></nav>;
}

function StocktakeStatusBadge({ status }: Readonly<{ status: StocktakeStatus }>) {
  const className = status === "POSTED" ? "bg-emerald-100 text-emerald-800" : status === "CONFIRMED" ? "bg-amber-100 text-amber-900" : status === "CANCELLED" ? "bg-slate-300 text-slate-800" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${className}`}>{stocktakeStatusLabel(status)}</span>;
}

function MasterReference({ fallbackId, kind, masters }: Readonly<{ fallbackId: string; kind: "product" | "unit"; masters: StocktakeMasters | null }>) {
  if (masters === null) return <span className="break-all font-mono text-xs">{fallbackId}</span>;
  if (kind === "product") {
    const product = masters.products.find((item) => item.id === fallbackId);
    if (product !== undefined) return <>{product.code} — {product.name}{product.status === "INACTIVE" ? " [無効]" : ""}</>;
  } else {
    const unit = masters.units.find((item) => item.id === fallbackId);
    if (unit !== undefined) return <>{unit.code} — {unit.name} ({unit.symbol}){unit.status === "INACTIVE" ? " [無効]" : ""}</>;
  }
  return <span className="break-all font-mono text-xs">{fallbackId}</span>;
}

function DetailItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt className="font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-950">{value}</dd></div>;
}

function StocktakeNotFound() {
  return <section aria-labelledby="stocktake-not-found-title" className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950" id="stocktake-not-found-title">棚卸が見つかりません</h1><p className="mt-3 text-sm text-slate-700">指定された棚卸は存在しないか、現在は参照できません。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/stocktakes">棚卸ワークスペースへ戻る</Link></section>;
}

function StocktakeLoadError({ message, retry }: Readonly<{ message: string; retry(): void }>) {
  return <section aria-labelledby="stocktake-load-error-title" className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-semibold text-red-950" id="stocktake-load-error-title">棚卸情報を表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>;
}

function StocktakeWriteAccessRequired({ backHref }: Readonly<{ backHref: string }>) {
  return <section aria-labelledby="stocktake-write-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="stocktake-write-required-title">棚卸書込権限がありません</h1><p className="mt-3 text-sm text-amber-900">棚卸下書きの作成・編集には棚卸参照・書込権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>棚卸詳細へ戻る</Link></section>;
}

function MasterReadAccessRequired({ backHref }: Readonly<{ backHref: string }>) {
  return <section aria-labelledby="stocktake-master-read-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="stocktake-master-read-required-title">マスター参照権限がありません</h1><p className="mt-3 text-sm text-amber-900">商品を安全に選択するためにマスター参照権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>棚卸詳細へ戻る</Link></section>;
}

function StocktakeNoLongerEditable({ stocktake }: Readonly<{ stocktake: Stocktake }>) {
  return <section aria-labelledby="stocktake-not-editable-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="stocktake-not-editable-title">この棚卸は編集できません</h1><p className="mt-3 text-sm text-amber-900">現在の状態は「{stocktakeStatusLabel(stocktake.status)}」です。下書きだけが編集できます。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/stocktakes/${encodeURIComponent(stocktake.id)}`}>棚卸詳細へ戻る</Link></section>;
}
