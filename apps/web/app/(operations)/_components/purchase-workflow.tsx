"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api-client";
import {
  emptyPurchaseForm,
  emptyPurchaseLine,
  formatPurchaseDate,
  formatPurchaseTimestamp,
  isAmbiguousPurchasePostingError,
  isPurchase,
  requestPurchaseList,
  requestPurchasePosting,
  PURCHASE_STATUSES,
  purchaseFormFromPurchase,
  purchasePayload,
  purchaseStatusLabel,
  validatePurchaseForm,
  type Purchase,
  type PurchaseFieldErrors,
  type PurchaseFormValues,
  type PurchaseListFilters,
  type PurchaseListPage,
  type PurchaseLineFormValues,
} from "@/lib/purchases";
import { isSupplierList, isUnitList, type Supplier, type Unit } from "@/lib/master-data";
import { isProductList, type Product } from "@/lib/products";
import { Field, FormError, SelectInput, TextArea, TextInput } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type PurchaseMasters = {
  products: Product[];
  suppliers: Supplier[];
  units: Unit[];
};

type MastersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; masters: PurchaseMasters }
  | { status: "error"; message: string };

type PurchaseState =
  | { status: "loading" }
  | { status: "ready"; purchase: Purchase }
  | { status: "not_found" }
  | { status: "error"; message: string };

type PurchaseListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; page: PurchaseListPage }
  | { status: "error"; message: string };

function protectedPurchaseError(error: unknown, refreshAuthentication: () => void): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === "unauthorized") return true;
  if (error.kind !== "forbidden") return false;
  refreshAuthentication();
  window.location.assign("/forbidden");
  return true;
}

function purchaseErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "仕入情報を処理できませんでした。時間をおいて再試行してください。";
}

function usePurchaseMasters(shouldLoad: boolean): { retry(): void; state: MastersState } {
  const { api, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<MastersState>({ status: shouldLoad ? "loading" : "idle" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }

    let active = true;
    void Promise.all([
      api.request<unknown>("/suppliers"),
      api.request<unknown>("/products"),
      api.request<unknown>("/units"),
    ]).then(([suppliers, products, units]) => {
      if (!isSupplierList(suppliers) || !isProductList(products) || !isUnitList(units)) {
        throw new ApiError("server");
      }
      if (active) setState({ status: "ready", masters: { suppliers, products, units } });
    }).catch((error: unknown) => {
      if (!active || protectedPurchaseError(error, refreshAuthentication)) return;
      setState({ status: "error", message: purchaseErrorMessage(error) });
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

async function requestPurchase(api: ApiClient, purchaseId: string): Promise<Purchase> {
  const payload = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}`);
  if (!isPurchase(payload)) throw new ApiError("server");
  return payload;
}

export function PurchaseWorkspacePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [purchaseId, setPurchaseId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<{ status: "" | Purchase["status"]; from: string; to: string; supplierCode: string; documentNumber: string }>({ status: "", from: "", to: "", supplierCode: "", documentNumber: "" });
  const [filters, setFilters] = useState<PurchaseListFilters>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const [retryKey, setRetryKey] = useState(0);
  const [listState, setListState] = useState<PurchaseListState>(() => permissions.has("purchase.read") ? { status: "loading" } : { status: "idle" });
  const canRead = permissions.has("purchase.read");

  useEffect(() => {
    if (!canRead) {
      return;
    }

    let active = true;
    void requestPurchaseList(api, filters, cursor).then((page) => {
      if (active) setListState({ status: "ready", page });
    }).catch((error: unknown) => {
      if (!active || protectedPurchaseError(error, refreshAuthentication)) return;
      setListState({ status: "error", message: purchaseErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canRead, cursor, filters, refreshAuthentication, retryKey]);

  function openPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = purchaseId.trim();
    if (id.length === 0) {
      setLookupError("仕入IDを入力してください。");
      return;
    }
    router.push(`/purchases/${encodeURIComponent(id)}`);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursor(undefined);
    setListState({ status: "loading" });
    setFilters({
      status: draftFilters.status || undefined,
      from: draftFilters.from.trim() || undefined,
      to: draftFilters.to.trim() || undefined,
      supplierCode: draftFilters.supplierCode.trim() || undefined,
      documentNumber: draftFilters.documentNumber.trim() || undefined,
    });
  }

  return (
    <section aria-labelledby="purchases-title" className="max-w-6xl">
      <PurchaseNavigation />
      <p className="text-sm font-medium text-blue-700">仕入</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="purchases-title">仕入一覧</h1>
      <p className="mt-3 text-sm text-slate-700">既存の仕入を検索し、詳細画面から確認・計上のワークフローへ進めます。金額や明細は一覧に表示しません。</p>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="purchase-create-card-title">
          <h2 className="text-xl font-bold text-slate-950" id="purchase-create-card-title">新しい仕入</h2>
          <p className="mt-2 text-sm text-slate-700">仕入先、商品、商品の在庫単位、数量、単価を入力して下書きを作成します。</p>
          {permissions.has("purchase.write") ? (
            <Link className="mt-5 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/purchases/new">仕入を作成</Link>
          ) : (
            <p className="mt-5 text-sm text-slate-600">下書きの作成には仕入書込権限が必要です。</p>
          )}
        </section>
        <section className="rounded-xl bg-white p-6 shadow-sm" aria-labelledby="purchase-open-card-title">
          <h2 className="text-xl font-bold text-slate-950" id="purchase-open-card-title">既存の仕入を開く</h2>
          {permissions.has("purchase.read") ? (
            <form className="mt-4" noValidate onSubmit={openPurchase}>
              <Field error={lookupError ?? undefined} htmlFor="purchase-id" label="仕入ID" required>
                <TextInput aria-describedby={lookupError === null ? undefined : "purchase-id-error"} id="purchase-id" onChange={(event) => { setPurchaseId(event.target.value); setLookupError(null); }} value={purchaseId} />
              </Field>
              <button className="mt-4 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" type="submit">詳細を開く</button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-slate-600">既存仕入の表示には仕入参照権限が必要です。</p>
          )}
        </section>
      </div>
      {canRead ? (
        <>
          <form className="mt-8 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm" noValidate onSubmit={applyFilters}>
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-status">状態
              <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-status" onChange={(event) => setDraftFilters((value) => ({ ...value, status: event.target.value as "" | Purchase["status"] }))} value={draftFilters.status}>
                <option value="">すべて</option>
                {PURCHASE_STATUSES.map((status) => <option key={status} value={status}>{purchaseStatusLabel(status)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-from">開始日時（UTC）
              <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-from" onChange={(event) => setDraftFilters((value) => ({ ...value, from: event.target.value }))} placeholder="2026-09-01T00:00:00.000Z" value={draftFilters.from} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-to">終了日時（UTC）
              <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-to" onChange={(event) => setDraftFilters((value) => ({ ...value, to: event.target.value }))} placeholder="2026-09-30T23:59:59.999Z" value={draftFilters.to} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-supplier-code">仕入先コード（完全一致）
              <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-supplier-code" onChange={(event) => setDraftFilters((value) => ({ ...value, supplierCode: event.target.value }))} value={draftFilters.supplierCode} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-document-number">伝票番号（完全一致）
              <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-document-number" onChange={(event) => setDraftFilters((value) => ({ ...value, documentNumber: event.target.value }))} value={draftFilters.documentNumber} />
            </label>
            <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" type="submit">適用</button>
          </form>
          <PurchaseListBody
            state={listState}
            onNext={(nextCursor) => { setListState({ status: "loading" }); setCursor(nextCursor); }}
            onRetry={() => { setListState({ status: "loading" }); setRetryKey((value) => value + 1); }}
          />
        </>
      ) : (
        <section className="mt-8 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6" aria-labelledby="purchase-read-required-title">
          <h2 className="text-xl font-bold text-amber-950" id="purchase-read-required-title">仕入参照権限がありません</h2>
          <p className="mt-3 text-sm text-amber-900">一覧と既存仕入の表示には仕入参照権限が必要です。</p>
        </section>
      )}
    </section>
  );
}

function PurchaseListBody({ onNext, onRetry, state }: Readonly<{
  state: PurchaseListState;
  onNext(cursor: string): void;
  onRetry(): void;
}>) {
  if (state.status === "loading" || state.status === "idle") {
    return <p className="mt-8 text-sm text-slate-700" role="status">仕入一覧を読み込んでいます…</p>;
  }
  if (state.status === "error") {
    return (
      <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6" aria-labelledby="purchase-list-error-title">
        <h2 className="text-xl font-semibold text-red-950" id="purchase-list-error-title">仕入一覧を表示できません</h2>
        <p className="mt-3 text-sm text-red-900" role="alert">{state.message}</p>
        <button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={onRetry} type="button">再試行</button>
      </section>
    );
  }
  if (state.page.items.length === 0) {
    return <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">条件に一致する仕入はありません。</p>;
  }

  return (
    <div className="mt-8">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">仕入日</th>
              <th className="px-4 py-3 font-semibold">状態</th>
              <th className="px-4 py-3 font-semibold">仕入先</th>
              <th className="px-4 py-3 font-semibold">伝票番号</th>
              <th className="px-4 py-3 font-semibold">計上日時</th>
              <th className="px-4 py-3"><span className="sr-only">詳細</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {state.page.items.map((purchase) => (
              <tr key={purchase.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatPurchaseDate(purchase.purchaseDate)}</td>
                <td className="px-4 py-3"><PurchaseStatusBadge status={purchase.status} /></td>
                <td className="px-4 py-3 text-slate-950"><span className="font-mono text-xs text-slate-700">{purchase.supplier.code}</span><span className="ml-2">{purchase.supplier.name}</span></td>
                <td className="px-4 py-3 text-slate-700">{purchase.documentNumber ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatPurchaseTimestamp(purchase.postedAt)}</td>
                <td className="px-4 py-3 text-right"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href={`/purchases/${encodeURIComponent(purchase.id)}`}>詳細</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.page.nextCursor !== null && (
        <button className="mt-4 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-white" onClick={() => onNext(state.page.nextCursor!)} type="button">次のページ</button>
      )}
    </div>
  );
}

export function PurchaseCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const nextLine = useRef(1);
  const [values, setValues] = useState<PurchaseFormValues>(() => emptyPurchaseForm("purchase-line-1"));
  const [errors, setErrors] = useState<PurchaseFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { retry, state: mastersState } = usePurchaseMasters(permissions.has("master.read"));

  function addLine() {
    const rowKey = `purchase-line-${nextLine.current += 1}`;
    setValues((current) => ({ ...current, items: [...current.items, emptyPurchaseLine(rowKey)] }));
  }

  function removeLine(rowKey: string) {
    setValues((current) => ({ ...current, items: current.items.filter((item) => item.rowKey !== rowKey) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePurchaseForm(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/purchases", { method: "POST", body: purchasePayload(values) });
      if (!isPurchase(created)) throw new ApiError("server");
      router.replace(`/purchases/${encodeURIComponent(created.id)}`);
    } catch (error: unknown) {
      if (!protectedPurchaseError(error, refreshAuthentication)) setFormError(purchaseErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("purchase.write")) return <PurchaseWriteAccessRequired backHref="/purchases" />;
  if (!permissions.has("master.read")) return <MasterReadAccessRequired backHref="/purchases" />;

  return (
    <section aria-labelledby="purchase-create-title" className="max-w-5xl">
      <PurchaseNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="purchase-create-title">仕入を新規作成</h1>
      <p className="mt-2 text-sm text-slate-700">計算と在庫への反映はサーバーが行います。数量・単価・税率は入力した10進数文字列のまま送信されます。</p>
      <MastersGate retry={retry} state={mastersState}>
        {(masters) => (
          <PurchaseForm
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

export function PurchaseEditPage({ purchaseId }: Readonly<{ purchaseId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const nextLine = useRef(1);
  const [state, setState] = useState<PurchaseState>({ status: "loading" });
  const [values, setValues] = useState<PurchaseFormValues>(() => emptyPurchaseForm("purchase-line-1"));
  const [errors, setErrors] = useState<PurchaseFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const { retry: retryMasters, state: mastersState } = usePurchaseMasters(permissions.has("master.read"));

  useEffect(() => {
    let active = true;
    void requestPurchase(api, purchaseId).then((purchase) => {
      if (!active) return;
      setState({ status: "ready", purchase });
      setValues(purchaseFormFromPurchase(purchase));
      nextLine.current = purchase.items.length;
    }).catch((error: unknown) => {
      if (!active || protectedPurchaseError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: purchaseErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, purchaseId, refreshAuthentication, retryKey]);

  function addLine() {
    const rowKey = `purchase-line-${nextLine.current += 1}`;
    setValues((current) => ({ ...current, items: [...current.items, emptyPurchaseLine(rowKey)] }));
  }

  function removeLine(rowKey: string) {
    setValues((current) => ({ ...current, items: current.items.filter((item) => item.rowKey !== rowKey) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePurchaseForm(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}`, { method: "PATCH", body: purchasePayload(values) });
      if (!isPurchase(updated)) throw new ApiError("server");
      router.replace(`/purchases/${encodeURIComponent(updated.id)}`);
    } catch (error: unknown) {
      if (!protectedPurchaseError(error, refreshAuthentication)) setFormError(purchaseErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!permissions.has("purchase.write")) return <PurchaseWriteAccessRequired backHref={`/purchases/${encodeURIComponent(purchaseId)}`} />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">仕入情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <PurchaseNotFound />;
  if (state.status === "error") return <PurchaseLoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;
  if (state.purchase.status !== "DRAFT") return <PurchaseNoLongerEditable purchase={state.purchase} />;
  if (!permissions.has("master.read")) return <MasterReadAccessRequired backHref={`/purchases/${encodeURIComponent(purchaseId)}`} />;

  return (
    <section aria-labelledby="purchase-edit-title" className="max-w-5xl">
      <PurchaseNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="purchase-edit-title">仕入下書きを編集</h1>
      <p className="mt-2 text-sm text-slate-700">下書きのみ編集できます。保存時には、サーバーが最新状態とマスターの有効状態を確認します。</p>
      <MastersGate retry={retryMasters} state={mastersState}>
        {(masters) => (
          <PurchaseForm
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

export function PurchaseDetailPage({ purchaseId }: Readonly<{ purchaseId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<PurchaseState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [action, setAction] = useState<"confirm" | "post" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);

  useEffect(() => {
    let active = true;
    void requestPurchase(api, purchaseId).then((purchase) => {
      if (active) setState({ status: "ready", purchase });
    }).catch((error: unknown) => {
      if (!active || protectedPurchaseError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: purchaseErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, purchaseId, refreshAuthentication, retryKey]);

  async function confirm() {
    if (action !== null || reloadRequired) return;
    setAction("confirm");
    setActionError(null);
    try {
      const latest = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}`);
      if (!isPurchase(latest)) throw new ApiError("server");
      setState({ status: "ready", purchase: latest });
      if (latest.status !== "DRAFT") return;
      const confirmed = await api.request<unknown>(`/purchases/${encodeURIComponent(purchaseId)}/confirm`, { method: "POST" });
      if (!isPurchase(confirmed)) throw new ApiError("server");
      setState({ status: "ready", purchase: confirmed });
    } catch (error: unknown) {
      if (!protectedPurchaseError(error, refreshAuthentication)) setActionError(purchaseErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function post() {
    if (action !== null || reloadRequired) return;
    setAction("post");
    setActionError(null);

    let latest: Purchase;
    try {
      latest = await requestPurchase(api, purchaseId);
      setState({ status: "ready", purchase: latest });
    } catch (error: unknown) {
      if (!protectedPurchaseError(error, refreshAuthentication)) setActionError(purchaseErrorMessage(error));
      setAction(null);
      return;
    }

    if (latest.status !== "DRAFT" && latest.status !== "CONFIRMED") {
      setAction(null);
      return;
    }

    try {
      const posted = await requestPurchasePosting(api, latest);
      setState({ status: "ready", purchase: posted });
    } catch (error: unknown) {
      if (protectedPurchaseError(error, refreshAuthentication)) return;
      if (isAmbiguousPurchasePostingError(error)) {
        setReloadRequired(true);
        setActionError("計上結果を確認できません。再計上は行わず、最新状態を再読み込みしてから続けてください。");
        return;
      }
      setActionError(purchaseErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  function reloadPurchase() {
    if (action !== null) return;
    setActionError(null);
    setReloadRequired(false);
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">仕入情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <PurchaseNotFound />;
  if (state.status === "error") return <PurchaseLoadError message={state.message} retry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;

  const { purchase } = state;
  return (
    <section aria-labelledby="purchase-detail-title" className="max-w-5xl">
      <PurchaseNavigation />
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/purchases">← 仕入ワークスペース</Link>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-slate-600">{purchase.id}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="purchase-detail-title">仕入詳細</h1>
            <p className="mt-2 text-sm text-slate-700">{purchase.supplier.code} — {purchase.supplier.name}</p>
          </div>
          <PurchaseStatusBadge status={purchase.status} />
        </div>
        <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">下書きは編集できます。確認後は編集できません。既存APIの契約により、下書きまたは確認済みの仕入を計上できます。計上済み・取消済みは再計上できません。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {!reloadRequired && purchase.status === "DRAFT" && permissions.has("purchase.write") && (
            <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/purchases/${encodeURIComponent(purchase.id)}/edit`}>下書きを編集</Link>
          )}
          {!reloadRequired && purchase.status === "DRAFT" && permissions.has("purchase.confirm") && (
            <button className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700" disabled={action !== null} onClick={() => void confirm()} type="button">{action === "confirm" ? "確認しています…" : "仕入を確認"}</button>
          )}
          {!reloadRequired && (purchase.status === "DRAFT" || purchase.status === "CONFIRMED") && permissions.has("purchase.post") && (
            <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" disabled={action !== null} onClick={() => void post()} type="button">{action === "post" ? "計上しています…" : "仕入を計上"}</button>
          )}
        </div>
        {reloadRequired && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm text-amber-950">計上結果が不明なため、この画面の変更操作を停止しています。最新状態を確認するまで再計上しないでください。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reloadPurchase} type="button">最新状態を再読み込み</button></div>}
        <FormError message={actionError} />
        <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
          <DetailItem label="仕入日" value={formatPurchaseDate(purchase.purchaseDate)} />
          <DetailItem label="伝票番号" value={purchase.documentNumber ?? "—"} />
          <DetailItem label="メモ" value={purchase.note ?? "—"} />
          <DetailItem label="計上日時" value={formatPurchaseTimestamp(purchase.postedAt)} />
          <DetailItem label="小計（サーバー計算）" value={purchase.subtotal} />
          <DetailItem label="税額（サーバー計算）" value={purchase.tax} />
          <DetailItem label="合計（サーバー計算）" value={purchase.total} />
          <DetailItem label="最終更新" value={formatPurchaseTimestamp(purchase.updatedAt)} />
        </dl>
        <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">行</th><th className="px-4 py-3 font-semibold">商品ID</th><th className="px-4 py-3 font-semibold">在庫単位ID</th><th className="px-4 py-3 text-right font-semibold">数量</th><th className="px-4 py-3 text-right font-semibold">単価</th><th className="px-4 py-3 text-right font-semibold">税率</th><th className="px-4 py-3 text-right font-semibold">金額</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{purchase.items.map((item) => <tr key={item.id}><td className="px-4 py-3 text-slate-700">{item.lineNumber}</td><td className="break-all px-4 py-3 font-mono text-xs text-slate-950">{item.productId}</td><td className="break-all px-4 py-3 font-mono text-xs text-slate-950">{item.unitId}</td><td className="px-4 py-3 text-right text-slate-950">{item.quantity}</td><td className="px-4 py-3 text-right text-slate-950">{item.unitPrice}</td><td className="px-4 py-3 text-right text-slate-950">{item.taxRate}</td><td className="px-4 py-3 text-right font-medium text-slate-950">{item.lineAmount}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PurchaseForm({ errors, formError, isSubmitting, masters, onAddLine, onChange, onRemoveLine, onSubmit, submitLabel, values }: Readonly<{
  errors: PurchaseFieldErrors;
  formError: string | null;
  isSubmitting: boolean;
  masters: PurchaseMasters;
  onAddLine(): void;
  onChange(next: PurchaseFormValues): void;
  onRemoveLine(rowKey: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  submitLabel: string;
  values: PurchaseFormValues;
}>) {
  function changeHeader(field: Exclude<keyof PurchaseFormValues, "items">, value: string) {
    onChange({ ...values, [field]: value });
  }

  function changeLine(rowKey: string, field: Exclude<keyof PurchaseLineFormValues, "rowKey">, value: string) {
    const selectedProduct = field === "productId" ? masters.products.find((product) => product.id === value) : undefined;
    onChange({
      ...values,
      items: values.items.map((item) => item.rowKey !== rowKey ? item : {
        ...item,
        [field]: value,
        ...(field === "productId" ? { unitId: selectedProduct?.inventoryUnitId ?? "" } : {}),
      }),
    });
  }

  return (
    <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={onSubmit}>
      <FormError message={formError} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field error={errors.supplierId} htmlFor="purchase-supplier" label="仕入先" required>
          <SelectInput aria-invalid={errors.supplierId === undefined ? undefined : true} id="purchase-supplier" onChange={(event) => changeHeader("supplierId", event.target.value)} required value={values.supplierId}>
            <option value="">選択してください</option>
            {values.supplierId.length > 0 && !masters.suppliers.some((supplier) => supplier.id === values.supplierId) && <option disabled value={values.supplierId}>利用できない仕入先（{values.supplierId}）</option>}
            {masters.suppliers.map((supplier) => <option disabled={supplier.status !== "ACTIVE"} key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}{supplier.status === "INACTIVE" ? " [無効]" : ""}</option>)}
          </SelectInput>
        </Field>
        <Field error={errors.purchaseDate} htmlFor="purchase-date" label="仕入日" required>
          <TextInput aria-invalid={errors.purchaseDate === undefined ? undefined : true} id="purchase-date" inputMode="numeric" onChange={(event) => changeHeader("purchaseDate", event.target.value)} pattern="\\d{4}-\\d{2}-\\d{2}" placeholder="YYYY-MM-DD" required value={values.purchaseDate} />
        </Field>
        <Field htmlFor="purchase-document-number" label="伝票番号">
          <TextInput id="purchase-document-number" maxLength={100} onChange={(event) => changeHeader("documentNumber", event.target.value)} value={values.documentNumber} />
        </Field>
        <div className="sm:col-span-2"><Field htmlFor="purchase-note" label="メモ"><TextArea id="purchase-note" onChange={(event) => changeHeader("note", event.target.value)} rows={3} value={values.note} /></Field></div>
      </div>
      <section aria-labelledby="purchase-items-title" className="border-t border-slate-200 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950" id="purchase-items-title">仕入明細</h2><p className="mt-1 text-sm text-slate-700">単位は選択した商品の在庫単位です。単位換算はこの画面では行いません。</p></div><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={onAddLine} type="button">明細を追加</button></div>
        {errors.items !== undefined && <p className="mt-3 text-sm text-red-800" role="alert">{errors.items}</p>}
        <div className="mt-5 space-y-5">{values.items.map((item, index) => <PurchaseLineEditor error={errors} index={index} item={item} key={item.rowKey} masters={masters} onChange={changeLine} onRemove={onRemoveLine} />)}</div>
      </section>
      <div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : submitLabel}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/purchases">キャンセル</Link></div>
    </form>
  );
}

function PurchaseLineEditor({ error, index, item, masters, onChange, onRemove }: Readonly<{
  error: PurchaseFieldErrors;
  index: number;
  item: PurchaseLineFormValues;
  masters: PurchaseMasters;
  onChange(rowKey: string, field: Exclude<keyof PurchaseLineFormValues, "rowKey">, value: string): void;
  onRemove(rowKey: string): void;
}>) {
  const selectedProduct = masters.products.find((product) => product.id === item.productId);
  const productKnown = selectedProduct !== undefined;
  const productUnitId = selectedProduct?.inventoryUnitId ?? "";
  const field = (name: string) => error[`items.${item.rowKey}.${name}`];
  const inputId = (name: string) => `purchase-line-${index + 1}-${name}`;
  const unitKnown = masters.units.some((unit) => unit.id === item.unitId);

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">明細 {index + 1}</legend>
      <div className="grid gap-5 md:grid-cols-3">
        <Field error={field("productId")} htmlFor={inputId("product")} label="商品" required>
          <SelectInput aria-invalid={field("productId") === undefined ? undefined : true} id={inputId("product")} onChange={(event) => onChange(item.rowKey, "productId", event.target.value)} required value={item.productId}>
            <option value="">選択してください</option>
            {item.productId.length > 0 && !productKnown && <option disabled value={item.productId}>利用できない商品（{item.productId}）</option>}
            {masters.products.map((product) => <option disabled={product.status !== "ACTIVE"} key={product.id} value={product.id}>{product.code} — {product.name}{product.status === "INACTIVE" ? " [無効]" : ""}</option>)}
          </SelectInput>
        </Field>
        <Field error={field("unitId")} htmlFor={inputId("unit")} label="在庫単位" required>
          <SelectInput aria-invalid={field("unitId") === undefined ? undefined : true} disabled={!productKnown} id={inputId("unit")} onChange={(event) => onChange(item.rowKey, "unitId", event.target.value)} required value={item.unitId}>
            <option value="">商品を選択してください</option>
            {item.unitId.length > 0 && !unitKnown && <option disabled value={item.unitId}>利用できない単位（{item.unitId}）</option>}
            {masters.units.map((unit) => <option disabled={unit.id !== productUnitId} key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}){unit.status === "INACTIVE" ? " [無効]" : ""}</option>)}
          </SelectInput>
        </Field>
        <Field error={field("quantity")} htmlFor={inputId("quantity")} label="数量" required>
          <TextInput aria-invalid={field("quantity") === undefined ? undefined : true} id={inputId("quantity")} inputMode="decimal" onChange={(event) => onChange(item.rowKey, "quantity", event.target.value)} required value={item.quantity} />
        </Field>
        <Field error={field("unitPrice")} htmlFor={inputId("unit-price")} label="単価" required>
          <TextInput aria-invalid={field("unitPrice") === undefined ? undefined : true} id={inputId("unit-price")} inputMode="decimal" onChange={(event) => onChange(item.rowKey, "unitPrice", event.target.value)} required value={item.unitPrice} />
        </Field>
        <Field error={field("taxRate")} htmlFor={inputId("tax-rate")} label="税率（0〜1）" required>
          <TextInput aria-invalid={field("taxRate") === undefined ? undefined : true} id={inputId("tax-rate")} inputMode="decimal" onChange={(event) => onChange(item.rowKey, "taxRate", event.target.value)} required value={item.taxRate} />
        </Field>
        <div className="flex items-end"><button className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" onClick={() => onRemove(item.rowKey)} type="button">この明細を削除</button></div>
      </div>
    </fieldset>
  );
}

function MastersGate({ children, retry, state }: Readonly<{ children: (masters: PurchaseMasters) => React.ReactNode; retry(): void; state: MastersState }>) {
  if (state.status === "loading" || state.status === "idle") return <p className="mt-8 text-sm text-slate-700" role="status">仕入先・商品・単位を読み込んでいます…</p>;
  if (state.status === "error") return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>;
  return <>{children(state.masters)}</>;
}

function PurchaseNavigation() {
  return <nav aria-label="仕入" className="mb-6 flex flex-wrap gap-4 text-sm"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/purchases">仕入ワークスペース</Link><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/purchases/new">仕入を作成</Link></nav>;
}

function PurchaseStatusBadge({ status }: Readonly<{ status: Purchase["status"] }>) {
  const className = status === "POSTED" ? "bg-emerald-100 text-emerald-800" : status === "CONFIRMED" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700";
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${className}`}>{purchaseStatusLabel(status)}</span>;
}

function DetailItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return <div><dt className="font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-slate-950">{value}</dd></div>;
}

function PurchaseNotFound() {
  return <section aria-labelledby="purchase-not-found-title" className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950" id="purchase-not-found-title">仕入が見つかりません</h1><p className="mt-3 text-sm text-slate-700">指定された仕入は存在しないか、現在は参照できません。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/purchases">仕入ワークスペースへ戻る</Link></section>;
}

function PurchaseLoadError({ message, retry }: Readonly<{ message: string; retry(): void }>) {
  return <section aria-labelledby="purchase-load-error-title" className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-semibold text-red-950" id="purchase-load-error-title">仕入情報を表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>;
}

function PurchaseWriteAccessRequired({ backHref }: Readonly<{ backHref: string }>) {
  return <section aria-labelledby="purchase-write-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="purchase-write-required-title">仕入書込権限がありません</h1><p className="mt-3 text-sm text-amber-900">仕入下書きの作成・編集には仕入書込権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>仕入詳細へ戻る</Link></section>;
}

function MasterReadAccessRequired({ backHref }: Readonly<{ backHref: string }>) {
  return <section aria-labelledby="master-read-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="master-read-required-title">マスター参照権限がありません</h1><p className="mt-3 text-sm text-amber-900">仕入先・商品・在庫単位を安全に選択するためにマスター参照権限が必要です。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={backHref}>仕入ワークスペースへ戻る</Link></section>;
}

function PurchaseNoLongerEditable({ purchase }: Readonly<{ purchase: Purchase }>) {
  return <section aria-labelledby="purchase-not-editable-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950" id="purchase-not-editable-title">この仕入は編集できません</h1><p className="mt-3 text-sm text-amber-900">現在の状態は「{purchaseStatusLabel(purchase.status)}」です。下書きだけが編集できます。</p><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/purchases/${encodeURIComponent(purchase.id)}`}>仕入詳細へ戻る</Link></section>;
}
