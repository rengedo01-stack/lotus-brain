"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  MASTER_STATUSES,
  type FieldErrors,
  type MasterStatus,
  type ProductUnitConversion,
  type Unit,
  isProductUnitConversionList,
  isUnitList,
  productUnitConversionCreatePayload,
  validateConversionCreate,
} from "@/lib/master-data";
import { isProduct, type Product } from "@/lib/products";
import { Field, fieldErrorProps, FormError, MasterNavigation, SelectInput, StatusBadge, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type PageState =
  | { status: "loading" }
  | { status: "ready"; conversions: ProductUnitConversion[]; product: Product; units: Unit[] }
  | { status: "not_found" }
  | { status: "error"; message: string };
type ConversionValues = { factorToBaseUnit: string; status: MasterStatus; unitId: string };

function handleProtectedError(error: unknown, refreshAuthentication: () => void): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === "unauthorized") return true;
  if (error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return true; }
  return false;
}

export function ProductConversionsPage({ productId }: Readonly<{ productId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [values, setValues] = useState<ConversionValues>({ unitId: "", factorToBaseUnit: "", status: "ACTIVE" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.request<unknown>(`/products/${encodeURIComponent(productId)}`),
      api.request<unknown>(`/products/${encodeURIComponent(productId)}/unit-conversions`),
      api.request<unknown>("/units?limit=100&offset=0"),
    ]).then(([productPayload, conversionPayload, unitsPayload]) => {
      if (!isProduct(productPayload) || !isProductUnitConversionList(conversionPayload) || !isUnitList(unitsPayload)) throw new ApiError("server");
      if (active) setState({ status: "ready", product: productPayload, conversions: conversionPayload, units: unitsPayload });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" });
      else setState({ status: "error", message: error instanceof ApiError ? error.message : "単位換算を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, productId, refreshAuthentication, reloadKey]);

  const candidates = useMemo(() => {
    if (state.status !== "ready") return [];
    const baseUnit = state.units.find((unit) => unit.id === state.product.baseUnitId);
    return state.units.filter((unit) => unit.id !== state.product.baseUnitId && (baseUnit === undefined || unit.dimension === baseUnit.dimension));
  }, [state]);

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">単位換算を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">商品が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/products">商品一覧へ戻る</Link></section>;
  if (state.status === "error") return <section className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900" onClick={() => { setState({ status: "loading" }); setReloadKey((current) => current + 1); }} type="button">再試行</button></section>;

  const unitById = new Map(state.units.map((unit) => [unit.id, unit]));
  function change(field: keyof ConversionValues, value: string) { setValues((current) => ({ ...current, [field]: value } as ConversionValues)); setErrors((current) => ({ ...current, [field]: "" })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateConversionCreate(values);
    setErrors(nextErrors); setFormError(null); setSuccessMessage(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await api.request<unknown>(`/products/${encodeURIComponent(productId)}/unit-conversions`, { method: "POST", body: productUnitConversionCreatePayload(values) });
      setValues({ unitId: "", factorToBaseUnit: "", status: "ACTIVE" });
      setSuccessMessage("単位換算を登録しました。最新の一覧を読み込んでいます。");
      setReloadKey((current) => current + 1);
    } catch (error: unknown) {
      if (handleProtectedError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "conflict") setFormError("この単位換算は既に登録されています。");
      else if (error instanceof ApiError && error.kind === "validation") setFormError("換算する単位と係数を確認してください。基準単位そのものは登録できません。");
      else setFormError(error instanceof ApiError ? error.message : "単位換算を登録できませんでした。時間をおいて再試行してください。");
    } finally { setIsSubmitting(false); }
  }

  return (
    <section aria-labelledby="conversions-title" className="max-w-4xl">
      <MasterNavigation />
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/products/${encodeURIComponent(productId)}`}>← 商品詳細</Link>
      <div className="mt-5"><p className="font-mono text-sm text-slate-600">{state.product.code}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="conversions-title">商品単位換算</h1><p className="mt-2 text-sm text-slate-700">「この単位1つが基準単位何個分か」を登録します。換算係数は小数文字列のまま送信されます。</p></div>
      <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">単位</th><th className="px-4 py-3 font-semibold">基準単位あたりの係数</th><th className="px-4 py-3 font-semibold">状態</th></tr></thead><tbody className="divide-y divide-slate-100">{state.conversions.length === 0 && <tr><td className="px-4 py-5 text-slate-700" colSpan={3}>登録済みの単位換算はありません。</td></tr>}{state.conversions.map((conversion) => { const unit = unitById.get(conversion.unitId); return <tr key={conversion.id}><td className="px-4 py-3 text-slate-950">{unit === undefined ? conversion.unitId : `${unit.code} — ${unit.name} (${unit.symbol})`}</td><td className="px-4 py-3 font-mono text-slate-950">{conversion.factorToBaseUnit}</td><td className="px-4 py-3"><StatusBadge status={conversion.status} /></td></tr>; })}</tbody></table></div>
      {permissions.has("master.write") ? <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => void submit(event)}><h2 className="text-xl font-bold text-slate-950">単位換算を追加</h2><FormError message={formError} />{successMessage !== null && <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{successMessage}</p>}<div className="grid gap-5 sm:grid-cols-3"><Field error={errors.unitId} htmlFor="conversion-unit" label="換算する単位" required><SelectInput {...fieldErrorProps("unitId", "conversion-unit", errors)} id="conversion-unit" onChange={(event) => change("unitId", event.target.value)} required value={values.unitId}><option value="">選択してください</option>{candidates.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}) {unit.status === "INACTIVE" ? "[無効]" : ""}</option>)}</SelectInput></Field><Field error={errors.factorToBaseUnit} htmlFor="conversion-factor" label="換算係数" required><TextInput {...fieldErrorProps("factorToBaseUnit", "conversion-factor", errors)} id="conversion-factor" inputMode="decimal" onChange={(event) => change("factorToBaseUnit", event.target.value)} required value={values.factorToBaseUnit} /><p className="mt-1 text-xs text-slate-600">例: 0.1、1.23456789</p></Field><Field error={errors.status} htmlFor="conversion-status" label="状態"><SelectInput id="conversion-status" onChange={(event) => change("status", event.target.value)} value={values.status}>{MASTER_STATUSES.map((status) => <option key={status} value={status}>{status === "ACTIVE" ? "有効" : "無効"}</option>)}</SelectInput></Field></div><div className="flex gap-3"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "登録しています…" : "単位換算を登録"}</button><Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/products/${encodeURIComponent(productId)}`}>商品詳細へ戻る</Link></div></form> : <WriteAccessRequired backHref={`/master/products/${encodeURIComponent(productId)}`} />}
    </section>
  );
}
