"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  clearProductSupplierCommercialTerms,
  createProductSupplierCommercialTerms,
  requestProductSupplierCommercialTerms,
  updateProductSupplierCommercialTerms,
  validateCommercialTaxRate,
  validateCommercialUnitPrice,
  type ProductSupplierCommercialTermsContext,
} from "@/lib/product-supplier-commercial-terms";
import { formatOperationalDate } from "@/lib/products";
import { Field, FormError, TextInput } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type CommercialTermsState =
  | { status: "loading" }
  | { status: "ready"; context: ProductSupplierCommercialTermsContext }
  | { status: "error"; message: string };

export function ProductSupplierCommercialTermsPanel({ relationshipId }: Readonly<{ relationshipId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<CommercialTermsState>({ status: "loading" });
  const [unitPrice, setUnitPrice] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    void requestProductSupplierCommercialTerms(api, relationshipId).then((context) => {
      if (!active) return;
      setState({ status: "ready", context });
      setUnitPrice(context.terms?.unitPrice ?? "");
      setTaxRate(context.terms?.taxRate ?? "");
    }).catch((requestError: unknown) => {
      if (!active || handleProtectedError(requestError, refreshAuthentication)) return;
      setState({ status: "error", message: errorMessage(requestError) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, relationshipId, retryKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || isSubmitting || !canConfigure(state.context)) return;
    const nextUnitPrice = unitPrice.trim();
    const nextTaxRate = taxRate.trim();
    const validationError = validateCommercialUnitPrice(nextUnitPrice) ?? validateCommercialTaxRate(nextTaxRate);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const context = state.context.terms === null
        ? await createProductSupplierCommercialTerms(api, relationshipId, nextUnitPrice, nextTaxRate)
        : await updateProductSupplierCommercialTerms(api, relationshipId, nextUnitPrice, nextTaxRate, state.context.terms.version);
      setState({ status: "ready", context });
      setUnitPrice(context.terms?.unitPrice ?? "");
      setTaxRate(context.terms?.taxRate ?? "");
    } catch (requestError: unknown) {
      if (!handleProtectedError(requestError, refreshAuthentication)) setError(errorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function clear() {
    if (state.status !== "ready" || state.context.terms === null || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const context = await clearProductSupplierCommercialTerms(api, relationshipId, state.context.terms.version);
      setState({ status: "ready", context });
      setUnitPrice("");
      setTaxRate("");
    } catch (requestError: unknown) {
      if (!handleProtectedError(requestError, refreshAuthentication)) setError(errorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="text-xl font-bold text-slate-950">仕入先別commercial terms</h2>
      <p className="mt-2 text-sm text-slate-700">これは人が管理する、将来の購買自動化向けの価格・税率authorityです。金額は商品のinventory unit 1単位あたり、通貨はJPY、単価は常に税抜です。PriceMasterの実績価格、Recommendation、Purchaseそのものとは異なります。</p>
      {state.status === "loading" && <p className="mt-4 text-sm text-slate-700" role="status">commercial termsを読み込んでいます…</p>}
      {state.status === "error" && <section className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{state.message}</p><button className="mt-3 font-medium underline" onClick={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} type="button">再試行</button></section>}
      {state.status === "ready" && <form className="mt-5 space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-5" noValidate onSubmit={(event) => void submit(event)}>
        <FormError message={error} />
        <p className="text-sm text-slate-700">在庫単位: <span className="font-medium text-slate-950">{state.context.relationship.product.inventoryUnit.name} ({state.context.relationship.product.inventoryUnit.symbol})</span></p>
        <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">未設定は「0円」や既存Purchase価格を意味しません。commercial authorityが未設定であることだけを表します。</p>
        {!canConfigure(state.context) && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">商品・仕入先・供給関係がすべて有効な場合にのみ、commercial termsを設定・更新できます。既存のtermsは保持され、解除だけは可能です。</p>}
        <Field htmlFor="commercial-terms-unit-price" label="税抜単価（inventory unitあたり）" required>
          <TextInput disabled={!permissions.has("master.write") || isSubmitting || !canConfigure(state.context)} id="commercial-terms-unit-price" inputMode="decimal" onChange={(event) => setUnitPrice(event.target.value)} placeholder="例: 120.500000" required value={unitPrice} />
        </Field>
        <Field htmlFor="commercial-terms-currency" label="通貨">
          <TextInput disabled id="commercial-terms-currency" value="JPY" />
        </Field>
        <Field htmlFor="commercial-terms-tax-rate" label="税率（0〜1）" required>
          <TextInput disabled={!permissions.has("master.write") || isSubmitting || !canConfigure(state.context)} id="commercial-terms-tax-rate" inputMode="decimal" onChange={(event) => setTaxRate(event.target.value)} placeholder="例: 0.1000" required value={taxRate} />
        </Field>
        <p className="text-xs text-slate-600">価格は税抜で固定です。税込／税抜の切替、税区分、価格履歴、有効期間はこの設定には含めません。</p>
        {state.context.terms !== null && <p className="text-xs text-slate-600">commercial terms version: {state.context.terms.version}（更新日時: {formatOperationalDate(state.context.terms.updatedAt)}）</p>}
        {permissions.has("master.write") ? <div className="flex flex-wrap gap-3"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting || !canConfigure(state.context)} type="submit">{isSubmitting ? "保存しています…" : state.context.terms === null ? "commercial termsを設定" : "commercial termsを更新"}</button>{state.context.terms !== null && <button className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={isSubmitting} onClick={() => void clear()} type="button">commercial termsを解除</button>}</div> : <p className="text-sm text-slate-700">commercial termsの編集にはマスター書込権限が必要です。</p>}
      </form>}
    </div>
  );
}

function canConfigure(context: ProductSupplierCommercialTermsContext): boolean {
  return context.relationship.product.status === "ACTIVE"
    && !context.relationship.product.isDeleted
    && context.relationship.supplier.status === "ACTIVE"
    && !context.relationship.supplier.isDeleted
    && context.relationship.status === "ACTIVE";
}

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
