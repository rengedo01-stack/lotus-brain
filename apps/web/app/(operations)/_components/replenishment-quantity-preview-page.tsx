"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { requestReplenishmentQuantityPreview, type ReplenishmentQuantityPreview } from "@/lib/inventory";
import { useOperationalApp } from "./operational-app";

type PreviewState = { status: "loading" } | { status: "ready"; preview: ReplenishmentQuantityPreview } | { status: "not_found" } | { status: "error"; message: string };

export function ReplenishmentQuantityPreviewPage({ productId }: Readonly<{ productId: string }>) {
  const { api, refreshAuthentication } = useOperationalApp();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void requestReplenishmentQuantityPreview(api, productId).then((preview) => {
      if (active) setState({ status: "ready", preview });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      if (error instanceof ApiError && error.kind === "not_found") { setState({ status: "not_found" }); return; }
      setState({ status: "error", message: error instanceof ApiError ? error.message : "補充数量の制約計算を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, productId, refreshAuthentication, retryKey]);

  if (state.status === "loading") return <p className="mt-8 text-sm text-slate-700" role="status">補充数量の制約計算を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">対象の商品が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/inventory/replenishment-candidates">補充確認候補へ戻る</Link></section>;
  if (state.status === "error") return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-bold text-red-950">補充数量を表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{state.message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} type="button">再試行</button></section>;
  return <PreviewDetails preview={state.preview} />;
}

function PreviewDetails({ preview }: Readonly<{ preview: ReplenishmentQuantityPreview }>) {
  const unit = preview.inventoryUnit.symbol;
  const result = preview.result;
  return <section aria-labelledby="replenishment-quantity-preview-title" className="max-w-5xl"><Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/inventory/replenishment-candidates">← 補充確認候補</Link><div className="mt-5 rounded-xl bg-white p-6 shadow-sm"><p className="font-mono text-sm text-slate-600">{preview.product.code}</p><h1 className="mt-1 text-3xl font-bold text-slate-950" id="replenishment-quantity-preview-title">補充数量の制約計算</h1><p className="mt-2 text-sm text-slate-700">これは現在の設定を説明する読み取り専用の計算です。Purchaseを作成せず、DRAFT・CONFIRMEDの未計上数量も計算には加算・控除しません。</p><Link className="mt-4 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/inventory/${encodeURIComponent(preview.product.id)}/replenishment-recommendation`}>不変recommendationを確認・管理</Link></div><dl className="mt-6 grid gap-4 sm:grid-cols-2"><Fact label="現在庫" value={quantity(preview.currentQuantity, unit)} /><Fact label="発注点" value={quantity(preview.reorderPointQuantity, unit)} /><Fact label="目標在庫" value={quantity(preview.targetStockQuantity, unit)} /><Fact label="raw target gap" value={quantity(result.rawTargetGap, unit)} /><Fact label="MOQ" value={quantity(preview.orderingTerms?.minimumOrderQuantity ?? null, unit)} /><Fact label="発注倍数" value={quantity(preview.orderingTerms?.orderMultipleQuantity ?? null, unit)} /><Fact label="優先仕入先" value={preview.preferredSupplier === null ? "未設定" : `${preview.preferredSupplier.supplier.code} — ${preview.preferredSupplier.supplier.name}${preview.preferredSupplier.isEligible ? "" : "（現在は非適格）"}`} /><Fact label="優先パッケージ" value={preview.preferredPackage === null ? "未設定（package制約なし）" : `${preview.preferredPackage.code} — ${preview.preferredPackage.name}${preview.preferredPackage.isEligible ? "" : "（現在は非適格）"}`} /><Fact label="パッケージサイズ" value={quantity(preview.preferredPackage?.inventoryQuantityPerPackage ?? null, unit)} /><Fact label="計算可能数量" value={quantity(result.feasibleQuantity, unit)} /><Fact label="パッケージ数" value={result.packageCount === null ? "—" : result.packageCount} /><Fact label="over-order" value={quantity(result.overOrderQuantity, unit)} /></dl><section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="font-semibold text-slate-950">結果: {resultLabel(result.status)}</h2><p className="mt-2 text-sm text-slate-800">{resultExplanation(result.status)}</p></section><section className="mt-6 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-950">参考情報（計算には使用しません）</h2><dl className="mt-3 grid gap-4 sm:grid-cols-2"><Fact label="DRAFT Purchaseの未計上明細数量" value={quantity(preview.draftPurchaseQuantity, unit)} /><Fact label="CONFIRMED Purchaseの未計上明細数量" value={quantity(preview.confirmedPurchaseQuantity, unit)} /></dl></section></section>;
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>; }
function quantity(value: string | null, unit: string): string { return value === null ? "—" : `${value} ${unit}`; }
function resultLabel(status: ReplenishmentQuantityPreview["result"]["status"]): string { return status === "READY" ? "計算可能" : status === "TARGET_NOT_CONFIGURED" ? "目標在庫が未設定" : status === "NO_POSITIVE_NEED" ? "追加数量は不要" : status === "INVENTORY_RECONCILIATION_REQUIRED" ? "在庫照合が必要" : status === "NO_PREFERRED_SUPPLIER" ? "優先仕入先が未設定" : status === "PREFERRED_SUPPLIER_INELIGIBLE" ? "優先仕入先が現在は非適格" : status === "PREFERRED_PACKAGE_INELIGIBLE" ? "優先パッケージが現在は非適格" : status === "CONSTRAINT_UNREPRESENTABLE" ? "現在の制約では数量を表現できません" : "補充確認候補の条件を満たしていません"; }
function resultExplanation(status: ReplenishmentQuantityPreview["result"]["status"]): string { return status === "READY" ? "目標在庫との差が正であり、MOQ・発注倍数・選択済みパッケージのすべてを同時に満たす最小数量を表示しています。" : status === "NO_POSITIVE_NEED" ? "目標在庫との差が正ではないため、MOQだけを理由に数量は作成しません。" : status === "INVENTORY_RECONCILIATION_REQUIRED" ? "現在庫が負数のため、自動的な補充数量の計算を停止しています。まず在庫を照合してください。" : status === "TARGET_NOT_CONFIGURED" ? "目標在庫が設定されていないため、発注点やゼロで代用して計算しません。" : "現在の安全側の条件では補充数量を確定しません。設定・状態を確認してください。"; }
