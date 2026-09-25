"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@/lib/api-client";
import {
  emptyPurchaseForm,
  emptyPurchaseLine,
  canExecutePurchaseReversal,
  canSubmitPurchaseReversal,
  canStartPurchaseReversal,
  completePurchaseReversal,
  createPurchaseReversalRequest,
  failPurchaseReversalPreview,
  formatPurchaseDate,
  formatPurchaseTimestamp,
  isAmbiguousPurchaseCancellationError,
  isAmbiguousPurchasePostingError,
  isAmbiguousPurchaseReversalError,
  markPurchaseReversalUnknown,
  requestPurchaseCancellation,
  confirmPurchaseDraft,
  createPurchaseDraft,
  requestPurchaseList,
  requestPurchaseDetail,
  requestPurchaseHandoffLineage,
  requestPurchasePosting,
  requestPurchaseReversal,
  requestPurchaseReversalAudit,
  requestPurchaseReversalPreview,
  settlePurchaseReversalPreview,
  startPurchaseReversalPreview,
  PURCHASE_STATUSES,
  purchaseFormFromPurchase,
  purchasePayload,
  purchaseStatusLabel,
  updatePurchaseDraft,
  validatePurchaseForm,
  type Purchase,
  type PurchaseFieldErrors,
  type PurchaseFormValues,
  type PurchaseListFilters,
  type PurchaseListPage,
  type PurchaseReversalPreview,
  type PurchaseReversalAudit,
  type PurchaseReversalResolutionValues,
  type PurchaseReversalWorkflowState,
  type PurchaseHandoffLineage,
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

type PurchaseHandoffLineageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; purchaseId: string; handoffs: PurchaseHandoffLineage[] }
  | { status: "error"; purchaseId: string; message: string };

type PurchaseReversalAuditState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; purchaseId: string; reversal: PurchaseReversalAudit | null }
  | { status: "error"; purchaseId: string; message: string };

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
  return requestPurchaseDetail(api, purchaseId);
}

export function PurchaseWorkspacePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [purchaseId, setPurchaseId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<{ status: "" | Purchase["status"]; correction: "" | "corrected" | "uncorrected"; from: string; to: string; supplierCode: string; documentNumber: string }>({ status: "", correction: "", from: "", to: "", supplierCode: "", documentNumber: "" });
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
      correction: draftFilters.correction || undefined,
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
            <label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor="purchase-list-correction">補正
              <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" id="purchase-list-correction" onChange={(event) => setDraftFilters((value) => ({ ...value, correction: event.target.value as "" | "corrected" | "uncorrected" }))} value={draftFilters.correction}>
                <option value="">すべて</option><option value="corrected">補正済み</option><option value="uncorrected">未補正</option>
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
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <PurchaseStatusBadge status={purchase.status} />
                    {purchase.correction !== null && <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-900">補正済み</span>}
                  </div>
                </td>
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
      const created = await createPurchaseDraft(api, purchasePayload(values));
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
      const updated = await updatePurchaseDraft(api, purchaseId, purchasePayload(values));
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
  const [handoffState, setHandoffState] = useState<PurchaseHandoffLineageState>({ status: "idle" });
  const [reversalAuditState, setReversalAuditState] = useState<PurchaseReversalAuditState>({ status: "idle" });
  const [retryKey, setRetryKey] = useState(0);
  const [reversalAuditRefreshKey, setReversalAuditRefreshKey] = useState(0);
  const [action, setAction] = useState<"confirm" | "post" | "cancel" | "reversal_preview" | "reversal_execute" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [reversalState, setReversalState] = useState<PurchaseReversalWorkflowState>({ phase: "idle" });
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalResolutionValues, setReversalResolutionValues] = useState<PurchaseReversalResolutionValues>({});
  const reversalIdempotencyKey = useRef<string | null>(null);
  const canReadHandoffLineage = ["inventory.read", "purchase.read", "master.read"].every((permission) => permissions.has(permission));
  const canReadReversalAudit = ["inventory.read", "purchase.read", "master.read"].every((permission) => permissions.has(permission));
  const hasReversePermission = permissions.has("purchase.reversePosted");

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

  useEffect(() => {
    if (!canReadHandoffLineage) {
      return;
    }

    let active = true;
    void requestPurchaseHandoffLineage(api, purchaseId).then((handoffs) => {
      if (active) setHandoffState({ status: "ready", purchaseId, handoffs });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      if (active) setHandoffState({ status: "error", purchaseId, message: purchaseErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canReadHandoffLineage, purchaseId, refreshAuthentication]);

  useEffect(() => {
    if (!canReadReversalAudit) return;

    let active = true;
    void requestPurchaseReversalAudit(api, purchaseId).then((reversal) => {
      if (active) setReversalAuditState({ status: "ready", purchaseId, reversal });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      if (active) setReversalAuditState({ status: "error", purchaseId, message: purchaseErrorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canReadReversalAudit, purchaseId, refreshAuthentication, reversalAuditRefreshKey]);

  const visibleHandoffState: PurchaseHandoffLineageState = !canReadHandoffLineage
    ? { status: "idle" }
    : handoffState.status === "ready" && handoffState.purchaseId === purchaseId
      ? handoffState
      : handoffState.status === "error" && handoffState.purchaseId === purchaseId
        ? handoffState
        : { status: "loading" };

  const visibleReversalAuditState: PurchaseReversalAuditState = !canReadReversalAudit
    ? { status: "idle" }
    : reversalAuditState.status === "ready" && reversalAuditState.purchaseId === purchaseId
      ? reversalAuditState
      : reversalAuditState.status === "error" && reversalAuditState.purchaseId === purchaseId
        ? reversalAuditState
        : { status: "loading" };

  async function confirm() {
    if (action !== null || reloadRequired) return;
    setAction("confirm");
    setActionError(null);
    try {
      const latest = await requestPurchaseDetail(api, purchaseId);
      setState({ status: "ready", purchase: latest });
      if (latest.status !== "DRAFT") return;
      const confirmed = await confirmPurchaseDraft(api, purchaseId);
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

  function openCancellation() {
    if (action !== null || reloadRequired) return;
    setActionError(null);
    setCancellationReason("");
    setCancellationOpen(true);
  }

  function closeCancellation() {
    if (action !== null) return;
    setActionError(null);
    setCancellationReason("");
    setCancellationOpen(false);
  }

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action !== null || reloadRequired) return;
    const normalizedReason = cancellationReason.trim();
    setActionError(null);
    if (normalizedReason.length === 0) {
      setActionError("取消理由を入力してください。");
      return;
    }
    if (normalizedReason.length > 10_000) {
      setActionError("取消理由は10,000文字以内で入力してください。");
      return;
    }

    setAction("cancel");
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
      setCancellationOpen(false);
      setActionError("仕入の状態が更新されています。取消できるのは下書きまたは確認済みの仕入だけです。");
      setAction(null);
      return;
    }

    try {
      const cancelled = await requestPurchaseCancellation(api, latest, cancellationReason);
      setState({ status: "ready", purchase: cancelled });
      setCancellationReason("");
      setCancellationOpen(false);
    } catch (error: unknown) {
      if (protectedPurchaseError(error, refreshAuthentication)) return;
      if (isAmbiguousPurchaseCancellationError(error)) {
        setCancellationOpen(false);
        setReloadRequired(true);
        setActionError("取消結果を確認できません。再取消は行わず、最新状態を再読み込みしてから続けてください。");
        return;
      }
      setActionError(purchaseErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  function resetReversalDraft() {
    reversalIdempotencyKey.current = null;
    setReversalReason("");
    setReversalResolutionValues({});
  }

  function resolutionValuesFromPreview(preview: Extract<PurchaseReversalWorkflowState, { phase: "preview_ready" }>["preview"]): PurchaseReversalResolutionValues {
    return Object.fromEntries(preview.priceEffects
      .filter((effect) => effect.requiresPriceResolution)
      .map((effect) => [effect.productId, {
        currentUnitPrice: effect.currentUnitPrice ?? "",
        currency: effect.currency ?? "",
      }]));
  }

  async function loadReversalPreview(reconciliation: boolean) {
    if (action !== null || reloadRequired) return;
    setAction("reversal_preview");
    setReversalError(null);
    setReversalState(startPurchaseReversalPreview(reconciliation));
    try {
      const preview = await requestPurchaseReversalPreview(api, purchaseId);
      const next = settlePurchaseReversalPreview(preview, !reconciliation);
      setReversalState(next);
      if (next.phase === "preview_ready") {
        resetReversalDraft();
        setReversalResolutionValues(resolutionValuesFromPreview(next.preview));
        if (!reconciliation) reversalIdempotencyKey.current = globalThis.crypto.randomUUID();
      } else {
        resetReversalDraft();
      }
    } catch (error: unknown) {
      if (!protectedPurchaseError(error, refreshAuthentication)) {
        setReversalState(failPurchaseReversalPreview(reconciliation));
        setReversalError(purchaseErrorMessage(error));
      }
    } finally {
      setAction(null);
    }
  }

  function closeReversalPreview() {
    if (action !== null || reversalState.phase === "unknown_result" || reversalState.phase === "completed") return;
    resetReversalDraft();
    setReversalError(null);
    setReversalState({ phase: "idle" });
  }

  async function executeReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reversalState.phase !== "preview_ready" || reloadRequired || !canSubmitPurchaseReversal(reversalState, action !== null)) return;
    const normalizedReason = reversalReason.trim();
    if (normalizedReason.length === 0) {
      setReversalError("補正理由を入力してください。");
      return;
    }
    if (normalizedReason.length > 10_000) {
      setReversalError("補正理由は10,000文字以内で入力してください。");
      return;
    }
    const idempotencyKey = reversalIdempotencyKey.current;
    if (idempotencyKey === null) {
      setReversalState(markPurchaseReversalUnknown());
      setReversalError("補正結果を安全に確認できません。最新の補正内容を確認してください。");
      return;
    }

    setAction("reversal_execute");
    setReversalError(null);
    try {
      const request = createPurchaseReversalRequest(
        reversalState.preview,
        normalizedReason,
        idempotencyKey,
        reversalResolutionValues,
      );
      const reversal = await requestPurchaseReversal(api, purchaseId, request);
      setReversalState(completePurchaseReversal(reversal));
      setReversalAuditState({ status: "loading" });
      setReversalAuditRefreshKey((current) => current + 1);
      resetReversalDraft();
    } catch (error: unknown) {
      if (protectedPurchaseError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "validation") {
        setReversalError("入力内容を確認してください。補正は記録されていません。");
        return;
      }
      if (isAmbiguousPurchaseReversalError(error)) {
        setReversalState(markPurchaseReversalUnknown());
        setReversalError("補正結果を確認できません。再実行は行わず、最新の補正内容を確認してください。");
        return;
      }
      setReversalError(purchaseErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  function reloadPurchase() {
    if (action !== null) return;
    setActionError(null);
    setCancellationOpen(false);
    setCancellationReason("");
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
        <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">下書きは編集できます。確認後は編集できません。下書きまたは確認済みの仕入は、理由を記録して取り消せます。計上済みの仕入は通常の取消対象ではありません。権限を持つ利用者だけが、現在時点の補正内容を確認できます。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {!reloadRequired && !cancellationOpen && purchase.status === "DRAFT" && permissions.has("purchase.write") && (
            <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/purchases/${encodeURIComponent(purchase.id)}/edit`}>下書きを編集</Link>
          )}
          {!reloadRequired && !cancellationOpen && purchase.status === "DRAFT" && permissions.has("purchase.confirm") && (
            <button className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700" disabled={action !== null} onClick={() => void confirm()} type="button">{action === "confirm" ? "確認しています…" : "仕入を確認"}</button>
          )}
          {!reloadRequired && !cancellationOpen && (purchase.status === "DRAFT" || purchase.status === "CONFIRMED") && permissions.has("purchase.post") && (
            <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" disabled={action !== null} onClick={() => void post()} type="button">{action === "post" ? "計上しています…" : "仕入を計上"}</button>
          )}
          {!reloadRequired && !cancellationOpen && ((purchase.status === "DRAFT" && permissions.has("purchase.write")) || (purchase.status === "CONFIRMED" && permissions.has("purchase.confirm"))) && (
            <button className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" disabled={action !== null} onClick={openCancellation} type="button">仕入を取り消す</button>
          )}
          {!reloadRequired && !cancellationOpen && canStartPurchaseReversal(purchase, hasReversePermission, reversalState) && (
            <button className="rounded-md border border-violet-400 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-950 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700" disabled={action !== null} onClick={() => void loadReversalPreview(false)} type="button">仕入補正を確認</button>
          )}
        </div>
        {cancellationOpen && (
          <form aria-labelledby="purchase-cancellation-title" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-5" noValidate onSubmit={(event) => void cancel(event)}>
            <h2 className="text-lg font-bold text-red-950" id="purchase-cancellation-title">仕入を取り消す</h2>
            <p className="mt-2 text-sm text-red-900">取り消すと元に戻せません。未計上の仕入だけが対象で、在庫・価格・Recommendationは変更しません。</p>
            <div className="mt-4"><Field error={actionError ?? undefined} htmlFor="purchase-cancellation-reason" label="取消理由" required><TextArea aria-describedby={actionError === null ? undefined : "purchase-cancellation-reason-error"} aria-invalid={actionError === null ? undefined : true} id="purchase-cancellation-reason" maxLength={10_000} onChange={(event) => { setCancellationReason(event.target.value); setActionError(null); }} required rows={4} value={cancellationReason} /></Field><p className="mt-2 text-right text-xs text-slate-600">{cancellationReason.length.toLocaleString("ja-JP")} / 10,000文字</p></div>
            <div className="mt-5 flex flex-wrap gap-3"><button className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" disabled={action !== null} type="submit">{action === "cancel" ? "取り消しています…" : "理由を記録して取り消す"}</button><button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400" disabled={action !== null} onClick={closeCancellation} type="button">戻る</button></div>
          </form>
        )}
        {reversalState.phase !== "idle" && (
          <PurchasePostedReversalPanel
            action={action}
            error={reversalError}
            onClose={closeReversalPreview}
            onExecute={(event) => void executeReversal(event)}
            onLoadPreview={(reconciliation) => void loadReversalPreview(reconciliation)}
            onReasonChange={(reason) => { setReversalReason(reason); setReversalError(null); }}
            onResolutionChange={(productId, field, value) => {
              setReversalResolutionValues((current) => ({
                ...current,
                [productId]: { ...current[productId]!, [field]: value },
              }));
              setReversalError(null);
            }}
            reason={reversalReason}
            resolutionValues={reversalResolutionValues}
            state={reversalState}
          />
        )}
        {reloadRequired && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm text-amber-950">操作結果が不明なため、この画面の変更操作を停止しています。最新状態を確認するまで、再計上・再取消はしないでください。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reloadPurchase} type="button">最新状態を再読み込み</button></div>}
        <FormError message={cancellationOpen ? null : actionError} />
        <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 text-sm sm:grid-cols-2">
          <DetailItem label="仕入日" value={formatPurchaseDate(purchase.purchaseDate)} />
          <DetailItem label="伝票番号" value={purchase.documentNumber ?? "—"} />
          <DetailItem label="メモ" value={purchase.note ?? "—"} />
          <DetailItem label="計上日時" value={formatPurchaseTimestamp(purchase.postedAt)} />
          {purchase.status === "CANCELLED" && <DetailItem label="取消日時" value={formatPurchaseTimestamp(purchase.cancelledAt)} />}
          {purchase.status === "CANCELLED" && <DetailItem label="取消理由" value={purchase.cancellationReason ?? "—"} />}
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
        <PurchaseReversalAuditPanel canRead={canReadReversalAudit} state={visibleReversalAuditState} />
        <PurchaseHandoffLineagePanel canRead={canReadHandoffLineage} state={visibleHandoffState} />
      </div>
    </section>
  );
}

function PurchasePostedReversalPanel({ action, error, onClose, onExecute, onLoadPreview, onReasonChange, onResolutionChange, reason, resolutionValues, state }: Readonly<{
  action: "confirm" | "post" | "cancel" | "reversal_preview" | "reversal_execute" | null;
  error: string | null;
  onClose(): void;
  onExecute(event: FormEvent<HTMLFormElement>): void;
  onLoadPreview(reconciliation: boolean): void;
  onReasonChange(reason: string): void;
  onResolutionChange(productId: string, field: "currentUnitPrice" | "currency", value: string): void;
  reason: string;
  resolutionValues: PurchaseReversalResolutionValues;
  state: PurchaseReversalWorkflowState;
}>) {
  if (state.phase === "preview_loading") {
    return <section aria-labelledby="purchase-reversal-title" className="mt-5 rounded-lg border border-violet-200 bg-violet-50 p-5"><h2 className="text-lg font-bold text-violet-950" id="purchase-reversal-title">仕入補正を確認</h2><p className="mt-2 text-sm text-violet-900" role="status">現在の在庫・価格影響を確認しています…</p></section>;
  }
  if (state.phase === "preview_error") {
    return <section aria-labelledby="purchase-reversal-title" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-5"><h2 className="text-lg font-bold text-red-950" id="purchase-reversal-title">仕入補正を確認できません</h2><p className="mt-2 text-sm text-red-900" role="alert">{error ?? "補正内容を確認できませんでした。"}</p><div className="mt-5 flex flex-wrap gap-3"><button className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={action !== null} onClick={() => onLoadPreview(state.reconciliation)} type="button">補正内容を再取得</button><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400" disabled={action !== null} onClick={onClose} type="button">戻る</button></div></section>;
  }
  if (state.phase === "unknown_result") {
    return <section aria-labelledby="purchase-reversal-title" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-bold text-amber-950" id="purchase-reversal-title">補正結果を確認する必要があります</h2><p className="mt-2 text-sm text-amber-900" role="alert">{error ?? "補正結果を確認できません。"} 同じ補正を再送せず、最新の補正内容を確認してください。</p><button className="mt-5 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={action !== null} onClick={() => onLoadPreview(true)} type="button">最新の補正内容を確認</button></section>;
  }
  if (state.phase === "completed") {
    return <section aria-labelledby="purchase-reversal-title" className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold text-emerald-950" id="purchase-reversal-title">仕入補正済み</h2><p className="mt-2 text-sm text-emerald-900">このPurchaseには補正記録があります。新しい補正操作はできません。</p><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><DetailItem label="対象Purchase" value={state.purchaseId} /><DetailItem label="reversal ID" value={state.reversal.id} /><DetailItem label="記録時刻" value={formatPurchaseTimestamp(state.reversal.reversedAt)} /></dl></section>;
  }
  if (state.phase !== "preview_ready") return null;

  const preview = state.preview;
  const executable = canExecutePurchaseReversal(state);
  const canSubmit = canSubmitPurchaseReversal(state, action !== null);
  const requiredPriceEffects = preview.priceEffects.filter((effect) => effect.requiresPriceResolution);
  return (
    <section aria-labelledby="purchase-reversal-title" className="mt-5 rounded-lg border border-violet-200 bg-violet-50 p-5">
      <h2 className="text-lg font-bold text-violet-950" id="purchase-reversal-title">仕入補正を確認</h2>
      <p className="mt-2 text-sm text-violet-900">元の仕入、receipt、PriceHistoryは変更・削除せず、現在時点の補正記録を追加します。</p>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><DetailItem label="対象Purchase" value={preview.purchaseId} /><DetailItem label="補正可能" value={preview.canReverse ? "可能" : "不可"} /></dl>
      {preview.refusalReasons.length > 0 && <section className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4" aria-labelledby="purchase-reversal-refusals-title"><h3 className="font-semibold text-amber-950" id="purchase-reversal-refusals-title">実行できない理由</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900" role="alert">{preview.refusalReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
      <section className="mt-5" aria-labelledby="purchase-reversal-inventory-title"><h3 className="font-semibold text-slate-950" id="purchase-reversal-inventory-title">在庫への予定影響</h3><div className="mt-3 overflow-x-auto rounded-md border border-violet-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">商品ID</th><th className="px-3 py-2 text-right">数量差分</th><th className="px-3 py-2 text-right">補正後数量</th><th className="px-3 py-2">在庫version</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.inventoryEffects.map((effect) => <tr key={effect.productId}><td className="break-all px-3 py-2 font-mono text-xs">{effect.productId}</td><td className="px-3 py-2 text-right">{effect.quantityDelta}</td><td className="px-3 py-2 text-right">{effect.quantityAfter ?? "—"}</td><td className="px-3 py-2">{effect.inventoryVersion ?? "—"}</td></tr>)}</tbody></table></div></section>
      <section className="mt-5" aria-labelledby="purchase-reversal-price-title"><h3 className="font-semibold text-slate-950" id="purchase-reversal-price-title">価格への予定影響</h3><div className="mt-3 overflow-x-auto rounded-md border border-violet-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">商品ID</th><th className="px-3 py-2">現在価格の由来</th><th className="px-3 py-2 text-right">現在単価</th><th className="px-3 py-2">price resolution</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.priceEffects.map((effect) => <tr key={effect.productId}><td className="break-all px-3 py-2 font-mono text-xs">{effect.productId}</td><td className="px-3 py-2">{purchaseReversalPriceSourceLabel(effect.source)}</td><td className="px-3 py-2 text-right">{effect.currentUnitPrice === null ? "—" : `${effect.currentUnitPrice} ${effect.currency ?? ""}`}</td><td className="px-3 py-2">{effect.requiresPriceResolution ? "入力が必要" : "不要"}</td></tr>)}</tbody></table></div></section>
      {executable && <form className="mt-5 rounded-md border border-violet-200 bg-white p-4" noValidate onSubmit={onExecute}><Field error={error ?? undefined} htmlFor="purchase-reversal-reason" label="補正理由" required><TextArea aria-describedby={error === null ? undefined : "purchase-reversal-reason-error"} aria-invalid={error === null ? undefined : true} id="purchase-reversal-reason" maxLength={10_000} onChange={(event) => onReasonChange(event.target.value)} required rows={4} value={reason} /></Field><p className="mt-2 text-right text-xs text-slate-600">{reason.length.toLocaleString("ja-JP")} / 10,000文字</p>{requiredPriceEffects.length > 0 && <fieldset className="mt-5 space-y-4"><legend className="font-semibold text-slate-950">必要なprice resolution</legend><p className="mt-1 text-sm text-slate-700">preview取得時点のPriceMaster versionを使います。現在値を再取得して差し替えることはありません。</p>{requiredPriceEffects.map((effect) => { const values = resolutionValues[effect.productId]!; return <div className="grid gap-4 rounded-md border border-slate-200 p-4 sm:grid-cols-2" key={effect.productId}><p className="break-all text-sm font-medium text-slate-950 sm:col-span-2">商品ID: <span className="font-mono text-xs">{effect.productId}</span> / version {effect.version}</p><label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor={`purchase-reversal-price-${effect.productId}`}>現在単価<input className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" id={`purchase-reversal-price-${effect.productId}`} inputMode="decimal" onChange={(event) => onResolutionChange(effect.productId, "currentUnitPrice", event.target.value)} value={values?.currentUnitPrice ?? ""} /></label><label className="grid gap-1 text-sm font-medium text-slate-800" htmlFor={`purchase-reversal-currency-${effect.productId}`}>通貨<input className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" id={`purchase-reversal-currency-${effect.productId}`} maxLength={3} onChange={(event) => onResolutionChange(effect.productId, "currency", event.target.value.toUpperCase())} value={values?.currency ?? ""} /></label></div>; })}</fieldset>}<div className="mt-5 flex flex-wrap gap-3"><button className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={!canSubmit} type="submit">{action === "reversal_execute" ? "補正を記録しています…" : "理由を記録して仕入補正を実行"}</button><button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={action !== null} onClick={onClose} type="button">戻る</button></div></form>}
      {!preview.canReverse && <div className="mt-5"><button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400" disabled={action !== null} onClick={onClose} type="button">戻る</button></div>}
      {preview.canReverse && !state.canExecute && <section className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-900">補正は見つかりませんでした。新しい補正手続きを開始する前に、最新のpreviewを取得します。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={action !== null} onClick={() => onLoadPreview(false)} type="button">新しい補正手続きを開始</button></section>}
    </section>
  );
}

function purchaseReversalPriceSourceLabel(source: PurchaseReversalPreview["priceEffects"][number]["source"]): string {
  if (source === "ORIGINAL_PURCHASE_CURRENT") return "元仕入が現在価格";
  if (source === "SUBSEQUENT_PRICE_HISTORY_CURRENT") return "後続PriceHistoryが現在価格";
  if (source === "LEGACY_UNKNOWN_CURRENT") return "既存価格の由来が不明";
  return "PriceMasterなし";
}

function purchaseReversalAuditPriceSourceLabel(source: PurchaseReversalAudit["priceEffects"][number]["source"]): string {
  if (source === "ORIGINAL_PURCHASE_CURRENT") return "元仕入が現在価格";
  if (source === "SUBSEQUENT_PRICE_HISTORY_CURRENT") return "後続PriceHistoryが現在価格";
  return "既存価格の由来が不明";
}

function PurchaseReversalAuditPanel({ canRead, state }: Readonly<{ canRead: boolean; state: PurchaseReversalAuditState }>) {
  if (!canRead || state.status === "idle" || state.status === "loading") return null;
  if (state.status === "error") {
    return <section aria-labelledby="purchase-reversal-audit-error-title" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6"><h2 className="text-lg font-bold text-red-950" id="purchase-reversal-audit-error-title">仕入補正の監査記録を表示できません</h2><p className="mt-2 text-sm text-red-900" role="alert">{state.message}</p><p className="mt-2 text-sm text-red-900">現在の在庫・PriceMaster・previewの値から補完することはありません。</p></section>;
  }
  if (state.reversal === null) return null;

  const reversal = state.reversal;
  return (
    <section aria-labelledby="purchase-reversal-audit-title" className="mt-8 rounded-xl border border-violet-200 bg-violet-50 p-6">
      <h2 className="text-lg font-bold text-violet-950" id="purchase-reversal-audit-title">仕入補正の監査記録</h2>
      <p className="mt-2 text-sm text-violet-900">ここに表示する内容は補正実行時に固定された監査snapshotです。現在の在庫・PriceMaster・マスターデータの状態を示すものではありません。</p>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <DetailItem label="reversal ID" value={reversal.id} />
        <DetailItem label="補正日時" value={formatPurchaseTimestamp(reversal.reversedAt)} />
        <DetailItem label="補正理由" value={reversal.reason} />
        <DetailItem label="actorUserId" value={reversal.actorUserId} />
      </dl>
      <section className="mt-6" aria-labelledby="purchase-reversal-audit-items-title">
        <h3 className="font-semibold text-slate-950" id="purchase-reversal-audit-items-title">元明細</h3>
        <div className="mt-3 overflow-x-auto rounded-md border border-violet-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">purchaseItemId</th><th className="px-3 py-2">productId</th><th className="px-3 py-2">inventoryUnitId</th><th className="px-3 py-2 text-right">数量</th><th className="px-3 py-2 text-right">単価</th><th className="px-3 py-2">通貨</th></tr></thead><tbody className="divide-y divide-slate-100">{reversal.items.map((item) => <tr key={item.purchaseItemId}><td className="break-all px-3 py-2 font-mono text-xs">{item.purchaseItemId}</td><td className="break-all px-3 py-2 font-mono text-xs">{item.productId}</td><td className="break-all px-3 py-2 font-mono text-xs">{item.inventoryUnitId}</td><td className="px-3 py-2 text-right">{item.quantity}</td><td className="px-3 py-2 text-right">{item.unitPrice}</td><td className="px-3 py-2">{item.currency}</td></tr>)}</tbody></table></div>
      </section>
      <section className="mt-6" aria-labelledby="purchase-reversal-audit-inventory-title">
        <h3 className="font-semibold text-slate-950" id="purchase-reversal-audit-inventory-title">在庫補正</h3>
        <div className="mt-3 overflow-x-auto rounded-md border border-violet-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">productId</th><th className="px-3 py-2">inventoryId</th><th className="px-3 py-2">inventoryUnitId</th><th className="px-3 py-2 text-right">数量差分</th><th className="px-3 py-2 text-right">補正実行時の補正後数量</th><th className="px-3 py-2 text-right">平均単価</th></tr></thead><tbody className="divide-y divide-slate-100">{reversal.inventoryEffects.map((effect) => <tr key={effect.inventoryId}><td className="break-all px-3 py-2 font-mono text-xs">{effect.productId}</td><td className="break-all px-3 py-2 font-mono text-xs">{effect.inventoryId}</td><td className="break-all px-3 py-2 font-mono text-xs">{effect.inventoryUnitId}</td><td className="px-3 py-2 text-right">{effect.quantityDelta}</td><td className="px-3 py-2 text-right">{effect.quantityAfter}</td><td className="px-3 py-2 text-right">{effect.averageUnitCost ?? "—"}</td></tr>)}</tbody></table></div>
      </section>
      <section className="mt-6" aria-labelledby="purchase-reversal-audit-price-title">
        <h3 className="font-semibold text-slate-950" id="purchase-reversal-audit-price-title">価格補正</h3>
        <p className="mt-2 text-sm text-slate-700">「補正実行時に現在価格へ設定」は、補正時点の設定結果であり、現在もcurrentであることを示しません。</p>
        <div className="mt-3 overflow-x-auto rounded-md border border-violet-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2">priceMasterId</th><th className="px-3 py-2">source</th><th className="px-3 py-2">previousCurrentPriceHistoryId</th><th className="px-3 py-2 text-right">previousVersion</th><th className="px-3 py-2 text-right">適用単価</th><th className="px-3 py-2">通貨</th><th className="px-3 py-2">effectiveAt</th><th className="px-3 py-2">補正実行時に現在価格へ設定</th><th className="px-3 py-2">priceHistoryId</th></tr></thead><tbody className="divide-y divide-slate-100">{reversal.priceEffects.map((effect) => <tr key={effect.priceMasterId}><td className="break-all px-3 py-2 font-mono text-xs">{effect.priceMasterId}</td><td className="px-3 py-2">{purchaseReversalAuditPriceSourceLabel(effect.source)}</td><td className="break-all px-3 py-2 font-mono text-xs">{effect.previousCurrentPriceHistoryId ?? "—"}</td><td className="px-3 py-2 text-right">{effect.previousVersion}</td><td className="px-3 py-2 text-right">{effect.appliedUnitPrice}</td><td className="px-3 py-2">{effect.appliedCurrency}</td><td className="px-3 py-2">{formatPurchaseTimestamp(effect.effectiveAt)}</td><td className="px-3 py-2">{effect.becomesCurrent ? "はい" : "いいえ"}</td><td className="break-all px-3 py-2 font-mono text-xs">{effect.priceHistoryId}</td></tr>)}</tbody></table></div>
      </section>
    </section>
  );
}

function PurchaseHandoffLineagePanel({ canRead, state }: Readonly<{ canRead: boolean; state: PurchaseHandoffLineageState }>) {
  if (!canRead) return <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Recommendation由来情報</h2><p className="mt-2 text-sm text-slate-700">表示には在庫・仕入・マスター参照権限が必要です。</p></section>;
  if (state.status === "idle" || state.status === "loading") return <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Recommendation由来情報</h2><p className="mt-2 text-sm text-slate-700" role="status">不変のhandoff lineageを読み込んでいます…</p></section>;
  if (state.status === "error") return <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6"><h2 className="text-lg font-bold text-red-950">Recommendation由来情報を表示できません</h2><p className="mt-2 text-sm text-red-900" role="alert">{state.message}</p><p className="mt-2 text-sm text-red-900">現在のマスター情報からlineageを推測・再構成することはありません。</p></section>;
  if (state.handoffs.length === 0) return <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Recommendation由来情報</h2><p className="mt-2 text-sm text-slate-700">このPurchaseにはRecommendation由来の明細はありません。</p></section>;
  return <section aria-labelledby="purchase-handoff-lineage-title" className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6"><h2 className="text-lg font-bold text-emerald-950" id="purchase-handoff-lineage-title">Recommendation由来情報</h2><p className="mt-2 text-sm text-emerald-900">以下はhandoff時点で固定された不変snapshotです。現在の仕入先・パッケージ・commercial termsから再構成していません。</p><div className="mt-5 space-y-5">{state.handoffs.map((handoff) => <article className="rounded-lg border border-emerald-200 bg-white p-5" key={handoff.purchaseItemId}><h3 className="font-semibold text-slate-950">明細 {handoff.lineNumber}</h3><dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><DetailItem label="source Recommendation ID" value={handoff.sourceRecommendationId} /><DetailItem label="PurchaseItem ID" value={handoff.purchaseItemId} /><DetailItem label="handoff作成時刻" value={handoff.createdAt} /><DetailItem label="推奨数量" value={handoff.source.recommendedQuantity} /><DetailItem label="供給関係 ID" value={handoff.source.relationshipId} /><DetailItem label="仕入先 ID" value={handoff.source.supplierId} /><DetailItem label="パッケージsnapshot" value={handoff.source.package === null ? "なし" : `${handoff.source.package.code} / ${handoff.source.package.quantity} / version ${handoff.source.package.version}`} /><DetailItem label="commercial terms snapshot" value={`JPY ${handoff.source.commercialTerms.unitPrice} / 税率 ${handoff.source.commercialTerms.taxRate} / version ${handoff.source.commercialTerms.version}`} /></dl></article>)}</div></section>;
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
  const className = status === "POSTED" ? "bg-emerald-100 text-emerald-800" : status === "CONFIRMED" ? "bg-amber-100 text-amber-900" : status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700";
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
