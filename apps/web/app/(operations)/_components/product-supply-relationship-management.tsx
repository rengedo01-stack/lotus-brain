"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { formatOperationalDate } from "@/lib/products";
import {
  createProductSupplyRelationship,
  requestProductSupplyRelationship,
  requestProductSupplyRelationshipProductOptions,
  requestProductSupplyRelationships,
  requestProductSupplyRelationshipSupplierOptions,
  updateProductSupplyRelationshipStatus,
  type ProductSupplyRelationship,
  type ProductSupplyRelationshipProductOption,
  type ProductSupplyRelationshipStatus,
  type ProductSupplyRelationshipSupplierOption,
} from "@/lib/product-supply-relationships";
import {
  createProductSupplierOrderingTerms,
  requestProductSupplierOrderingTerms,
  updateProductSupplierOrderingTerms,
  validateOrderingTermsQuantity,
  type ProductSupplierOrderingTermsContext,
} from "@/lib/product-supplier-ordering-terms";
import {
  createProductSupplierPackage,
  requestProductSupplierPackages,
  updateProductSupplierPackage,
  validatePackageQuantity,
  type ProductSupplierPackage,
  type ProductSupplierPackageContext,
  type ProductSupplierPackageStatus,
  type ProductSupplierPackagesContext,
} from "@/lib/product-supplier-packages";
import {
  clearProductSupplierPackagePreference,
  clearProductSupplyPreference,
  requestProductSupplierPackagePreference,
  requestProductSupplyPreference,
  setProductSupplierPackagePreference,
  setProductSupplyPreference,
  type ProductSupplierPackagePreferenceContext,
  type ProductSupplyPreferenceContext,
} from "@/lib/product-supply-preferences";
import { ProductSupplierCommercialTermsPanel } from "./product-supplier-commercial-terms-panel";
import { Field, FormError, MasterNavigation, SelectInput, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

const pageSize = 100;

type RelationshipListState =
  | { status: "loading" }
  | { status: "ready"; relationships: ProductSupplyRelationship[] }
  | { status: "error"; message: string };
type RelationshipDetailState =
  | { status: "loading" }
  | { status: "ready"; relationship: ProductSupplyRelationship }
  | { status: "not_found" }
  | { status: "error"; message: string };
type OptionsState =
  | { status: "loading" }
  | { status: "ready"; products: ProductSupplyRelationshipProductOption[]; suppliers: ProductSupplyRelationshipSupplierOption[] }
  | { status: "error"; message: string };
type OrderingTermsState =
  | { status: "loading" }
  | { status: "ready"; context: ProductSupplierOrderingTermsContext }
  | { status: "error"; message: string };
type PackagesState =
  | { status: "loading" }
  | { status: "ready"; context: ProductSupplierPackagesContext }
  | { status: "error"; message: string };

function handleProtectedError(error: unknown, refreshAuthentication: () => void): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === "unauthorized") return true;
  if (error.kind === "forbidden") {
    refreshAuthentication();
    window.location.assign("/forbidden");
    return true;
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "保存できませんでした。時間をおいて再試行してください。";
  if (error.kind === "conflict") return "現在の状態では保存できません。最新の情報を確認してください。";
  if (error.kind === "validation") return "入力内容を確認してください。";
  return error.message;
}

function relationshipStatusLabel(status: ProductSupplyRelationshipStatus): string {
  return status === "ACTIVE" ? "管理中" : "無効";
}

function RelationshipStatusBadge({ status }: Readonly<{ status: ProductSupplyRelationshipStatus }>) {
  return (
    <span className={status === "ACTIVE" ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800" : "rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700"}>
      {relationshipStatusLabel(status)}
    </span>
  );
}

export function ProductSupplyRelationshipsPage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [offset, setOffset] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<RelationshipListState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void requestProductSupplyRelationships(api, pageSize, offset).then((relationships) => {
      if (active) setState({ status: "ready", relationships });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, offset, refreshAuthentication, retryKey]);

  return (
    <section aria-labelledby="supply-relationships-title">
      <MasterNavigation />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-700">マスター</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="supply-relationships-title">供給関係</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">商品と仕入先の組み合わせを、Lotus BRAIN上で管理対象の供給関係として扱うかを管理します。価格、発注条件、納入条件は含みません。</p>
        </div>
        {permissions.has("master.write") && <Link className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/supply-relationships/new">供給関係を追加</Link>}
      </div>
      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">供給関係を読み込んでいます…</p>}
      {state.status === "error" && <ErrorPanel message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />}
      {state.status === "ready" && state.relationships.length === 0 && <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">登録された供給関係はありません。</p>}
      {state.status === "ready" && state.relationships.length > 0 && <>
        <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">商品</th><th className="px-4 py-3 font-semibold">仕入先</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3 font-semibold">更新日時</th><th className="px-4 py-3"><span className="sr-only">詳細</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{state.relationships.map((relationship) => <tr className="hover:bg-slate-50" key={relationship.id}><td className="px-4 py-3"><p className="font-mono text-xs text-slate-700">{relationship.product.code}</p><p className="font-medium text-slate-950">{relationship.product.name}</p></td><td className="px-4 py-3"><p className="font-mono text-xs text-slate-700">{relationship.supplier.code}</p><p className="font-medium text-slate-950">{relationship.supplier.name}</p></td><td className="px-4 py-3"><RelationshipStatusBadge status={relationship.status} /></td><td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatOperationalDate(relationship.updatedAt)}</td><td className="px-4 py-3 text-right"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/supply-relationships/${encodeURIComponent(relationship.id)}`}>詳細</Link></td></tr>)}</tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-700"><p>{offset + 1}件目から表示中</p><div className="flex gap-2"><button className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400" disabled={offset === 0} onClick={() => { setState({ status: "loading" }); setOffset((current) => Math.max(0, current - pageSize)); }} type="button">前へ</button><button className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400" disabled={state.relationships.length < pageSize} onClick={() => { setState({ status: "loading" }); setOffset((current) => current + pageSize); }} type="button">次へ</button></div></div>
      </>}
    </section>
  );
}

export function ProductSupplyRelationshipCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [productId, setProductId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestProductSupplyRelationshipProductOptions(api),
      requestProductSupplyRelationshipSupplierOptions(api),
    ]).then(([products, suppliers]) => {
      if (active) setOptions({ status: "ready", products, suppliers });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      setOptions({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey]);

  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/supply-relationships" />;
  const activeProducts = options.status === "ready" ? options.products.filter((product) => product.status === "ACTIVE" && product.deletedAt === null) : [];
  const activeSuppliers = options.status === "ready" ? options.suppliers.filter((supplier) => supplier.status === "ACTIVE" && supplier.deletedAt === null) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (productId.length === 0 || supplierId.length === 0) {
      setFormError("商品と仕入先を選択してください。");
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const relationship = await createProductSupplyRelationship(api, productId, supplierId);
      router.replace(`/master/supply-relationships/${encodeURIComponent(relationship.id)}`);
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <section aria-labelledby="supply-relationship-create-title" className="max-w-3xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="supply-relationship-create-title">供給関係を追加</h1><p className="mt-2 text-sm text-slate-700">有効な商品と仕入先の組み合わせを、管理対象の供給関係として登録します。これは発注可否や価格、納入条件を表しません。</p>{options.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">選択肢を読み込んでいます…</p>}{options.status === "error" && <ErrorPanel message={options.message} onRetry={() => { setOptions({ status: "loading" }); setRetryKey((current) => current + 1); }} />}{options.status === "ready" && <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => void submit(event)}><FormError message={formError} /><Field htmlFor="supply-relationship-product" label="商品" required><SelectInput id="supply-relationship-product" onChange={(event) => setProductId(event.target.value)} required value={productId}><option value="">選択してください</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.name}</option>)}</SelectInput></Field><Field htmlFor="supply-relationship-supplier" label="仕入先" required><SelectInput id="supply-relationship-supplier" onChange={(event) => setSupplierId(event.target.value)} required value={supplierId}><option value="">選択してください</option>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.name}</option>)}</SelectInput></Field><div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">登録後は管理中になります。無効化したrelationshipは、親の商品・仕入先が有効な場合にのみ再有効化できます。</div><div className="flex flex-wrap gap-3 pt-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : "供給関係を追加"}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" href="/master/supply-relationships">キャンセル</Link></div></form>}</section>;
}

export function ProductSupplyRelationshipDetailPage({ relationshipId }: Readonly<{ relationshipId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<RelationshipDetailState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void requestProductSupplyRelationship(api, relationshipId).then((relationship) => {
      if (active) setState({ status: "ready", relationship });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" });
      else setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, relationshipId, retryKey]);

  async function changeStatus(status: ProductSupplyRelationshipStatus) {
    if (state.status !== "ready" || isSubmitting) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const updated = await updateProductSupplyRelationshipStatus(api, state.relationship.id, status, state.relationship.version);
      setState({ status: "ready", relationship: updated });
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">供給関係を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">供給関係が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/supply-relationships">供給関係一覧へ戻る</Link></section>;
  if (state.status === "error") return <ErrorPanel message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} />;
  const { relationship } = state;
  const nextStatus: ProductSupplyRelationshipStatus = relationship.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  const actionLabel = nextStatus === "ACTIVE" ? "管理中に戻す" : "無効化する";
  const parentsActive = relationship.product.status === "ACTIVE" && !relationship.product.isDeleted && relationship.supplier.status === "ACTIVE" && !relationship.supplier.isDeleted;
  const cannotEnable = nextStatus === "ACTIVE" && !parentsActive;

  return <section aria-labelledby="supply-relationship-detail-title" className="max-w-3xl"><MasterNavigation /><Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/supply-relationships">← 供給関係一覧</Link><div className="mt-5 rounded-xl bg-white p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-700">供給関係</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="supply-relationship-detail-title">{relationship.product.name} — {relationship.supplier.name}</h1></div><RelationshipStatusBadge status={relationship.status} /></div><p className="mt-3 text-sm text-slate-700">この関係は、Lotus BRAIN上で管理対象の供給関係かだけを示します。発注可否、価格、納入条件は示しません。</p><dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 sm:grid-cols-2"><Detail label="商品" value={`${relationship.product.code} — ${relationship.product.name}`} /><Detail label="仕入先" value={`${relationship.supplier.code} — ${relationship.supplier.name}`} /><Detail label="relationship ID" value={relationship.id} mono /><Detail label="version" value={String(relationship.version)} /><Detail label="登録日時" value={formatOperationalDate(relationship.createdAt)} /><Detail label="更新日時" value={formatOperationalDate(relationship.updatedAt)} /></dl>{permissions.has("master.write") && <div className="mt-8 border-t border-slate-200 pt-6"><FormError message={formError} />{cannotEnable && <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">商品または仕入先が有効ではないため、この関係を管理中に戻せません。</p>}<button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={isSubmitting || cannotEnable} onClick={() => void changeStatus(nextStatus)} type="button">{isSubmitting ? "保存しています…" : actionLabel}</button></div>}<SupplierPreferencePanel relationship={relationship} /><OrderingTermsPanel relationshipId={relationship.id} /><ProductSupplierCommercialTermsPanel relationshipId={relationship.id} /><PackageManagementPanel relationshipId={relationship.id} /></div></section>;
}

function SupplierPreferencePanel({ relationship }: Readonly<{ relationship: ProductSupplyRelationship }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [context, setContext] = useState<ProductSupplyPreferenceContext | null>(null); const [error, setError] = useState<string | null>(null); const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { let active = true; void requestProductSupplyPreference(api, relationship.productId).then((value) => { if (active) setContext(value); }).catch((value: unknown) => { if (active && !handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); }); return () => { active = false; }; }, [api, refreshAuthentication, relationship.productId, retryKey]);
  if (context === null && error === null) return <p className="mt-6 text-sm text-slate-700">通常使う仕入先を読み込んでいます…</p>;
  if (error !== null) return <ErrorPanel message={error} onRetry={() => { setContext(null); setError(null); setRetryKey((value) => value + 1); }} />;
  const preferred = context!.preference;
  const current = preferred?.relationshipId === relationship.id;
  async function set() { try { setContext(await setProductSupplyPreference(api, relationship.productId, relationship.id, preferred?.version ?? null)); } catch (value: unknown) { if (!handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); } }
  async function clear() { if (!preferred) return; try { setContext(await clearProductSupplyPreference(api, relationship.productId, preferred.version)); } catch (value: unknown) { if (!handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); } }
  return <div className="mt-8 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold text-slate-950">通常使用する仕入先</h2><p className="mt-2 text-sm text-slate-700">これはoperatorが通常使う供給関係として明示した選択です。価格、在庫、利用可能性、推奨発注とは同義ではありません。</p>{preferred ? <p className="mt-3 text-sm text-slate-800">現在: <strong>{preferred.relationship.supplier.code} — {preferred.relationship.supplier.name}</strong>{preferred.isEligible ? "" : "（現在は選択条件を満たしていません）"}</p> : <p className="mt-3 text-sm text-slate-700">未設定です。</p>}{permissions.has("master.write") && <div className="mt-3 flex gap-3"><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" onClick={() => void set()} type="button">{current ? "この供給関係を通常使用として更新" : "この供給関係を通常使用にする"}</button>{preferred && <button className="text-sm font-medium text-red-700" onClick={() => void clear()} type="button">通常使用を解除</button>}</div>}</div>;
}

function OrderingTermsPanel({ relationshipId }: Readonly<{ relationshipId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<OrderingTermsState>({ status: "loading" });
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState("");
  const [orderMultipleQuantity, setOrderMultipleQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    void requestProductSupplierOrderingTerms(api, relationshipId).then((context) => {
      if (!active) return;
      setState({ status: "ready", context });
      setMinimumOrderQuantity(context.terms?.minimumOrderQuantity ?? "");
      setOrderMultipleQuantity(context.terms?.orderMultipleQuantity ?? "");
    }).catch((requestError: unknown) => {
      if (!active || handleProtectedError(requestError, refreshAuthentication)) return;
      setState({ status: "error", message: errorMessage(requestError) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, relationshipId, retryKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || isSubmitting) return;
    const minimum = minimumOrderQuantity.trim();
    const multiple = orderMultipleQuantity.trim();
    const minimumError = validateOrderingTermsQuantity(minimum);
    const multipleError = validateOrderingTermsQuantity(multiple);
    if (minimumError !== null || multipleError !== null) {
      setError(minimumError ?? multipleError);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const context = state.context.terms === null
        ? await createProductSupplierOrderingTerms(api, relationshipId, minimum || null, multiple || null)
        : await updateProductSupplierOrderingTerms(api, relationshipId, minimum || null, multiple || null, state.context.terms.version);
      setState({ status: "ready", context });
      setMinimumOrderQuantity(context.terms?.minimumOrderQuantity ?? "");
      setOrderMultipleQuantity(context.terms?.orderMultipleQuantity ?? "");
    } catch (requestError: unknown) {
      if (!handleProtectedError(requestError, refreshAuthentication)) setError(errorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <div className="mt-8 border-t border-slate-200 pt-6"><h2 className="text-xl font-bold text-slate-950">仕入先別発注条件</h2><p className="mt-2 text-sm text-slate-700">数量は商品の在庫単位（inventory unit）で管理します。Supplier固有の梱包・発注単位、価格、発注推奨は扱いません。発注フローにはまだ適用されません。</p>{state.status === "loading" && <p className="mt-4 text-sm text-slate-700" role="status">発注条件を読み込んでいます…</p>}{state.status === "error" && <ErrorPanel message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />}{state.status === "ready" && <form className="mt-5 space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-5" noValidate onSubmit={(event) => void submit(event)}><FormError message={error} /><p className="text-sm text-slate-700">在庫単位: <span className="font-medium text-slate-950">{state.context.relationship.product.inventoryUnit.name} ({state.context.relationship.product.inventoryUnit.symbol})</span></p><Field htmlFor="ordering-terms-minimum" label="最小発注数量"><TextInput id="ordering-terms-minimum" inputMode="decimal" onChange={(event) => setMinimumOrderQuantity(event.target.value)} placeholder="未設定" value={minimumOrderQuantity} /></Field><Field htmlFor="ordering-terms-multiple" label="発注倍数"><TextInput id="ordering-terms-multiple" inputMode="decimal" onChange={(event) => setOrderMultipleQuantity(event.target.value)} placeholder="未設定" value={orderMultipleQuantity} /></Field><p className="text-xs text-slate-600">空欄は制約なしです。設定時は0より大きい数量を入力します。倍数の丸めや推奨発注量の計算は行いません。</p>{state.context.terms !== null && <p className="text-xs text-slate-600">条件version: {state.context.terms.version}（更新日時: {formatOperationalDate(state.context.terms.updatedAt)}）</p>}{permissions.has("master.write") ? <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : state.context.terms === null ? "発注条件を設定" : "発注条件を更新"}</button> : <p className="text-sm text-slate-700">発注条件の編集にはマスター書込権限が必要です。</p>}</form>}</div>;
}

type PackageDraft = {
  code: string;
  name: string;
  inventoryQuantityPerPackage: string;
  isOrderable: boolean;
  status: ProductSupplierPackageStatus;
};

const emptyPackageDraft: PackageDraft = {
  code: "",
  name: "",
  inventoryQuantityPerPackage: "",
  isOrderable: false,
  status: "ACTIVE",
};

function PackageManagementPanel({ relationshipId }: Readonly<{ relationshipId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<PackagesState>({ status: "loading" });
  const [draft, setDraft] = useState<PackageDraft>(emptyPackageDraft);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    void requestProductSupplierPackages(api, relationshipId).then((context) => {
      if (active) setState({ status: "ready", context });
    }).catch((requestError: unknown) => {
      if (!active || handleProtectedError(requestError, refreshAuthentication)) return;
      setState({ status: "error", message: errorMessage(requestError) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, relationshipId, retryKey]);

  function beginCreate() {
    setEditingPackageId(null);
    setDraft(emptyPackageDraft);
    setError(null);
  }

  function beginEdit(packageValue: ProductSupplierPackage) {
    setEditingPackageId(packageValue.id);
    setDraft({
      code: packageValue.code,
      name: packageValue.name,
      inventoryQuantityPerPackage: packageValue.inventoryQuantityPerPackage,
      isOrderable: packageValue.isOrderable,
      status: packageValue.status,
    });
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || isSubmitting) return;
    const normalized: PackageDraft = {
      ...draft,
      code: draft.code.trim(),
      name: draft.name.trim(),
      inventoryQuantityPerPackage: draft.inventoryQuantityPerPackage.trim(),
    };
    if (normalized.code.length === 0 || normalized.name.length === 0) {
      setError("梱包コードと名称を入力してください。");
      return;
    }
    const quantityError = validatePackageQuantity(normalized.inventoryQuantityPerPackage);
    if (quantityError !== null) {
      setError(quantityError);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      let response: ProductSupplierPackageContext;
      const isCreate = editingPackageId === null;
      if (editingPackageId === null) {
        response = await createProductSupplierPackage(api, relationshipId, normalized);
      } else {
        const current = state.context.packages.find((item) => item.id === editingPackageId);
        if (current === undefined) {
          setError("梱包の最新状態を確認してください。");
          return;
        }
        response = await updateProductSupplierPackage(api, relationshipId, current.id, normalized, current.version);
      }
      const nextPackages = isCreate
        ? [...state.context.packages, response.package]
        : state.context.packages.map((item) => item.id === response.package.id ? response.package : item);
      nextPackages.sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
      setState({ status: "ready", context: { relationship: response.relationship, packages: nextPackages } });
      beginCreate();
    } catch (requestError: unknown) {
      if (!handleProtectedError(requestError, refreshAuthentication)) setError(errorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <div className="mt-8 border-t border-slate-200 pt-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">仕入先別梱包</h2><p className="mt-2 text-sm text-slate-700">この供給関係に固有の梱包を、商品の在庫単位へ直接換算して管理します。梱包はグローバル単位ではなく、通常使用する梱包の選択は下の欄で別途管理します。発注推奨やPurchaseへの適用は行いません。</p></div>{permissions.has("master.write") && <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" onClick={beginCreate} type="button">新しい梱包を追加</button>}</div>{state.status === "loading" && <p className="mt-4 text-sm text-slate-700" role="status">梱包を読み込んでいます…</p>}{state.status === "error" && <ErrorPanel message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />}{state.status === "ready" && <><p className="mt-4 text-sm text-slate-700">在庫単位: <span className="font-medium text-slate-950">{state.context.relationship.product.inventoryUnit.name} ({state.context.relationship.product.inventoryUnit.symbol})</span></p>{state.context.packages.length === 0 ? <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">登録された梱包はありません。</p> : <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2 font-semibold">梱包</th><th className="px-3 py-2 font-semibold">換算</th><th className="px-3 py-2 font-semibold">将来の発注単位候補</th><th className="px-3 py-2 font-semibold">状態</th><th className="px-3 py-2"><span className="sr-only">編集</span></th></tr></thead><tbody className="divide-y divide-slate-100">{state.context.packages.map((packageValue) => <tr key={packageValue.id}><td className="px-3 py-2"><p className="font-mono text-xs text-slate-700">{packageValue.code}</p><p className="font-medium text-slate-950">{packageValue.name}</p></td><td className="whitespace-nowrap px-3 py-2 text-slate-700">1 {packageValue.code} = {packageValue.inventoryQuantityPerPackage} {state.context.relationship.product.inventoryUnit.symbol}</td><td className="px-3 py-2 text-slate-700">{packageValue.isOrderable ? packageValue.status === "ACTIVE" ? "将来の候補" : "有効時に将来の候補" : "候補にしない"}</td><td className="px-3 py-2 text-slate-700">{packageValue.status === "ACTIVE" ? "有効" : "無効"}</td><td className="px-3 py-2 text-right">{permissions.has("master.write") && <button className="font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => beginEdit(packageValue)} type="button">編集</button>}</td></tr>)}</tbody></table></div>}{permissions.has("master.write") && <form className="mt-5 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5" noValidate onSubmit={(event) => void submit(event)}><h3 className="text-base font-bold text-slate-950">{editingPackageId === null ? "梱包を追加" : "梱包を更新"}</h3><FormError message={error} /><div className="grid gap-4 sm:grid-cols-2"><Field htmlFor="supplier-package-code" label="梱包コード" required><TextInput id="supplier-package-code" onChange={(event) => setDraft((value) => ({ ...value, code: event.target.value }))} required value={draft.code} /></Field><Field htmlFor="supplier-package-name" label="梱包名称" required><TextInput id="supplier-package-name" onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} required value={draft.name} /></Field></div><Field htmlFor="supplier-package-quantity" label={`1梱包あたりの在庫数量（${state.context.relationship.product.inventoryUnit.symbol}）`} required><TextInput id="supplier-package-quantity" inputMode="decimal" onChange={(event) => setDraft((value) => ({ ...value, inventoryQuantityPerPackage: event.target.value }))} required value={draft.inventoryQuantityPerPackage} /></Field><label className="flex items-center gap-2 text-sm text-slate-800"><input checked={draft.isOrderable} onChange={(event) => setDraft((value) => ({ ...value, isOrderable: event.target.checked }))} type="checkbox" />この梱包を将来の発注単位候補として管理する</label><Field htmlFor="supplier-package-status" label="状態"><SelectInput id="supplier-package-status" onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as ProductSupplierPackageStatus }))} value={draft.status}><option value="ACTIVE">有効</option><option value="DISABLED">無効</option></SelectInput></Field><p className="text-xs text-slate-600">端数梱包、丸め、発注倍数・MOQとの整合、Purchaseへの適用は扱いません。通常使用する梱包の選択は、このフォームの外で管理します。</p><div className="flex flex-wrap gap-3"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : editingPackageId === null ? "梱包を追加" : "梱包を更新"}</button>{editingPackageId !== null && <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-white" onClick={beginCreate} type="button">新規作成に戻る</button>}</div></form>}<PackagePreferencePanel relationshipId={relationshipId} packages={state.context.packages} /></>}</div>;
}

function PackagePreferencePanel({ relationshipId, packages }: Readonly<{ relationshipId: string; packages: ProductSupplierPackage[] }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp(); const [context, setContext] = useState<ProductSupplierPackagePreferenceContext | null>(null); const [error, setError] = useState<string | null>(null); const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { let active = true; void requestProductSupplierPackagePreference(api, relationshipId).then((value) => { if (active) setContext(value); }).catch((value: unknown) => { if (active && !handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); }); return () => { active = false; }; }, [api, refreshAuthentication, relationshipId, retryKey]);
  if (!context && !error) return <p className="mt-5 text-sm text-slate-700">通常使用する梱包を読み込んでいます…</p>; if (error) return <ErrorPanel message={error} onRetry={() => { setContext(null); setError(null); setRetryKey((value) => value + 1); }} />;
  const eligible = packages.filter((value) => value.status === "ACTIVE" && value.isOrderable); const preferred = context!.preference;
  async function choose(packageId: string) { try { setContext(await setProductSupplierPackagePreference(api, relationshipId, packageId, preferred?.version ?? null)); } catch (value: unknown) { if (!handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); } }
  async function clear() { if (!preferred) return; try { setContext(await clearProductSupplierPackagePreference(api, relationshipId, preferred.version)); } catch (value: unknown) { if (!handleProtectedError(value, refreshAuthentication)) setError(errorMessage(value)); } }
  return <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold text-slate-950">通常使用する梱包</h3><p className="mt-1 text-sm text-slate-700">価格、最小過剰、最安、推奨発注とは別の、operatorによる通常の選択です。</p><p className="mt-2 text-sm">{preferred ? <>現在: <strong>{preferred.package.code} — {preferred.package.name}</strong>{preferred.isEligible ? "" : "（現在は選択条件を満たしていません）"}</> : "未設定です。"}</p>{permissions.has("master.write") && <div className="mt-3 flex flex-wrap gap-2">{eligible.map((value) => <button className="rounded border border-slate-300 px-2 py-1 text-sm" key={value.id} onClick={() => void choose(value.id)} type="button">{value.code}を通常使用にする</button>)}{preferred && <button className="px-2 py-1 text-sm text-red-700" onClick={() => void clear()} type="button">解除</button>}</div>}</div>;
}

function Detail({ label, mono = false, value }: Readonly<{ label: string; mono?: boolean; value: string }>) {
  return <div><dt className="text-sm font-medium text-slate-600">{label}</dt><dd className={`mt-1 break-words text-sm text-slate-950${mono ? " font-mono" : ""}`}>{value}</dd></div>;
}

function ErrorPanel({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  return <section className="mt-8 max-w-xl rounded-lg border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-900" role="alert">{message}</p><button className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={onRetry} type="button">再試行</button></section>;
}
