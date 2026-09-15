"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  createPurchaseDraftFromRecommendation,
  formatPurchaseDate,
  isCanonicalUtcTimestamp,
  purchaseStatusLabel,
  requestRecommendationPurchaseHandoffLineage,
  type RecommendationPurchaseHandoffLineage,
} from "@/lib/purchases";
import { dismissReplenishmentRecommendation, recalculateReplenishmentRecommendation, requestActiveReplenishmentRecommendation, type ReplenishmentRecommendation } from "@/lib/replenishment-recommendations";
import { useOperationalApp } from "./operational-app";

type PageState = { status: "loading" } | { status: "ready"; recommendation: ReplenishmentRecommendation | null } | { status: "error"; message: string };
type HandoffState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; recommendationId: string; handoff: RecommendationPurchaseHandoffLineage | null }
  | { status: "error"; recommendationId: string; message: string };

export function ReplenishmentRecommendationPage({ productId }: Readonly<{ productId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [handoffState, setHandoffState] = useState<HandoffState>({ status: "idle" });
  const [retryKey, setRetryKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canManage = ["inventory.read", "purchase.read", "master.read", "replenishment.manage"].every((permission) => permissions.has(permission));
  const canReadHandoff = ["inventory.read", "purchase.read", "master.read"].every((permission) => permissions.has(permission));
  const canCreateHandoff = canManage && permissions.has("purchase.write");

  useEffect(() => {
    let active = true;
    void requestActiveReplenishmentRecommendation(api, productId).then((recommendation) => {
      if (active) setState({ status: "ready", recommendation });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      setState({ status: "error", message: error instanceof ApiError ? error.message : "補充recommendationを読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, productId, refreshAuthentication, retryKey]);

  const recommendationId = state.status === "ready" ? state.recommendation?.id ?? null : null;
  useEffect(() => {
    if (!canReadHandoff || recommendationId === null) {
      return;
    }

    let active = true;
    void requestRecommendationPurchaseHandoffLineage(api, recommendationId).then((handoff) => {
      if (active) setHandoffState({ status: "ready", recommendationId, handoff });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      if (active) setHandoffState({ status: "error", recommendationId, message: error instanceof ApiError ? error.message : "handoff状態を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, canReadHandoff, recommendationId, refreshAuthentication]);

  const visibleHandoffState: HandoffState = !canReadHandoff || recommendationId === null
    ? { status: "idle" }
    : handoffState.status === "ready" && handoffState.recommendationId === recommendationId
      ? handoffState
      : handoffState.status === "error" && handoffState.recommendationId === recommendationId
        ? handoffState
        : { status: "loading" };

  async function recalculate() {
    if (!canManage || isSubmitting) return;
    setIsSubmitting(true); setMessage(null);
    try {
      const recommendation = await recalculateReplenishmentRecommendation(api, productId);
      // The exact mutation response is authoritative. Do not issue a second
      // read to infer whether a replacement snapshot was created.
      setState({ status: "ready", recommendation });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      setMessage(error instanceof ApiError && error.kind === "conflict" ? "現在の計算がREADYではないか、入力が更新されています。制約計算を確認してから明示的に再試行してください。" : error instanceof ApiError ? error.message : "recommendationを作成できませんでした。");
    } finally { setIsSubmitting(false); }
  }

  async function dismiss() {
    if (!canManage || isSubmitting || state.status !== "ready" || state.recommendation === null) return;
    setIsSubmitting(true); setMessage(null);
    try {
      const dismissed = await dismissReplenishmentRecommendation(api, productId, state.recommendation.id, state.recommendation.version);
      setState({ status: "ready", recommendation: null });
      setMessage(`recommendationを却下しました（記録 ${dismissed.id}）。`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
      setMessage(error instanceof ApiError && error.kind === "conflict" ? "このrecommendationはすでに更新されています。最新の状態を確認してください。" : error instanceof ApiError ? error.message : "recommendationを却下できませんでした。");
    } finally { setIsSubmitting(false); }
  }

  if (state.status === "loading") return <p className="mt-8 text-sm text-slate-700" role="status">補充recommendationを読み込んでいます…</p>;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />;
  return <section aria-labelledby="replenishment-recommendation-title" className="max-w-5xl">
    <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href={`/inventory/${encodeURIComponent(productId)}/replenishment-quantity-preview`}>← 補充数量の制約計算</Link>
    <div className="mt-5 rounded-xl bg-white p-6 shadow-sm"><h1 className="text-3xl font-bold text-slate-950" id="replenishment-recommendation-title">補充recommendation</h1><p className="mt-2 text-sm text-slate-700">これはREADY時点の不変snapshotです。Purchaseは作成せず、DRAFT・CONFIRMED数量も数量計算へ加算・控除しません。</p></div>
    {message !== null && <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">{message}</p>}
    {state.recommendation === null ? <NoActiveRecommendation canManage={canManage} isSubmitting={isSubmitting} onRecalculate={() => void recalculate()} /> : <RecommendationDetails canCreateHandoff={canCreateHandoff} canManage={canManage} handoffState={visibleHandoffState} isSubmitting={isSubmitting} onDismiss={() => void dismiss()} onHandoff={async (purchaseDate) => {
      if (isSubmitting || handoffState.status !== "ready" || handoffState.handoff !== null) return;
      setIsSubmitting(true); setMessage(null);
      try {
        const purchase = await createPurchaseDraftFromRecommendation(api, state.recommendation!.id, purchaseDate);
        // Both exact 201 creation and exact 200 idempotent replay return a
        // validated Purchase. No follow-up mutation or inference is needed.
        router.push(`/purchases/${encodeURIComponent(purchase.id)}`);
      } catch (error: unknown) {
        if (error instanceof ApiError && error.kind === "unauthorized") return;
        if (error instanceof ApiError && error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return; }
        setMessage(error instanceof ApiError && error.kind === "conflict" ? "handoffの前提が現在の状態と一致しません。recommendationを確認してから明示的に再試行してください。" : error instanceof ApiError ? error.message : "Purchase下書きを作成できませんでした。");
      } finally { setIsSubmitting(false); }
    }} onRecalculate={() => void recalculate()} recommendation={state.recommendation} />}
  </section>;
}

function NoActiveRecommendation({ canManage, isSubmitting, onRecalculate }: Readonly<{ canManage: boolean; isSubmitting: boolean; onRecalculate(): void }>) {
  return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">有効なrecommendationはありません</h2><p className="mt-2 text-sm text-slate-700">不変snapshotは、現在の制約計算がREADYのときだけ明示的に作成できます。</p>{canManage ? <button className="mt-5 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-slate-400" disabled={isSubmitting} onClick={onRecalculate} type="button">{isSubmitting ? "作成しています…" : "現在の条件で作成"}</button> : <p className="mt-5 text-sm text-slate-700">作成・再計算・却下には補充管理権限が必要です。</p>}</section>;
}

function RecommendationDetails({ recommendation, canManage, canCreateHandoff, handoffState, isSubmitting, onRecalculate, onDismiss, onHandoff }: Readonly<{ recommendation: ReplenishmentRecommendation; canManage: boolean; canCreateHandoff: boolean; handoffState: HandoffState; isSubmitting: boolean; onRecalculate(): void; onDismiss(): void; onHandoff(purchaseDate: string): Promise<void> }>) {
  const unit = recommendation.inventoryUnit.symbol;
  return <><div className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><p className="font-mono text-sm text-slate-600">{recommendation.product.code}</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{recommendation.product.name}</h2><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Fact label="snapshot状態" value={dispositionLabel(recommendation.disposition)} /><Fact label="現在との整合性" value={freshnessLabel(recommendation.freshness)} /><Fact label="作成時刻" value={recommendation.createdAt} /><Fact label="計算ポリシーversion" value={String(recommendation.calculationPolicyVersion)} /></dl></div><section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6"><h2 className="text-lg font-bold text-slate-950">確定時の数量説明</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><Fact label="現在庫" value={quantity(recommendation.snapshot.currentQuantity, unit)} /><Fact label="発注点" value={quantity(recommendation.snapshot.reorderPointQuantity, unit)} /><Fact label="目標在庫" value={quantity(recommendation.snapshot.targetStockQuantity, unit)} /><Fact label="raw target gap" value={quantity(recommendation.snapshot.result.rawTargetGap, unit)} /><Fact label="MOQ" value={quantity(recommendation.snapshot.orderingTerms?.minimumOrderQuantity ?? null, unit)} /><Fact label="発注倍数" value={quantity(recommendation.snapshot.orderingTerms?.orderMultipleQuantity ?? null, unit)} /><Fact label="実行可能数量" value={quantity(recommendation.snapshot.result.feasibleQuantity, unit)} /><Fact label="over-order" value={quantity(recommendation.snapshot.result.overOrderQuantity, unit)} /><Fact label="優先仕入先" value={`${recommendation.snapshot.preferredSupplier.supplier.code} — ${recommendation.snapshot.preferredSupplier.supplier.name}`} /><Fact label="優先パッケージ" value={recommendation.snapshot.preferredPackage === null ? "未設定（package制約なし）" : `${recommendation.snapshot.preferredPackage.code} — ${recommendation.snapshot.preferredPackage.name}`} /><Fact label="パッケージ数" value={recommendation.snapshot.result.packageCount ?? "—"} /><Fact label="Inventory revision" value={String(recommendation.snapshot.inventoryVersion)} /></dl></section><section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">参考情報（数量計算には使用しません）</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><Fact label="DRAFT Purchaseの未計上明細数量" value={quantity(recommendation.snapshot.draftPurchaseQuantity, unit)} /><Fact label="CONFIRMED Purchaseの未計上明細数量" value={quantity(recommendation.snapshot.confirmedPurchaseQuantity, unit)} /></dl></section><RecommendationHandoffPanel canCreateHandoff={canCreateHandoff} handoffState={handoffState} isSubmitting={isSubmitting} onHandoff={onHandoff} recommendation={recommendation} />{canManage ? <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">ライフサイクル操作</h2><p className="mt-2 text-sm text-slate-700">再計算は新しいimmutable snapshotを作成し、この記録をSUPERSEDEDにします。却下は数量・入力snapshotを変更せず、ACTIVE記録をDISMISSEDにします。</p><div className="mt-5 flex flex-wrap gap-3"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:bg-slate-400" disabled={isSubmitting} onClick={onRecalculate} type="button">{isSubmitting ? "処理しています…" : "現在の条件で再計算"}</button><button className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:text-slate-400" disabled={isSubmitting} onClick={onDismiss} type="button">却下</button></div></section> : <p className="mt-6 text-sm text-slate-700">このsnapshotの作成・再計算・却下には補充管理権限が必要です。</p>}</>;
}

function RecommendationHandoffPanel({ recommendation, canCreateHandoff, handoffState, isSubmitting, onHandoff }: Readonly<{ recommendation: ReplenishmentRecommendation; canCreateHandoff: boolean; handoffState: HandoffState; isSubmitting: boolean; onHandoff(purchaseDate: string): Promise<void> }>) {
  const [purchaseDate, setPurchaseDate] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isCanonicalUtcTimestamp(purchaseDate)) {
      setDateError("仕入日時をUTCのISO形式（例: 2026-09-15T00:00:00.000Z）で指定してください。");
      return;
    }
    setDateError(null);
    void onHandoff(purchaseDate);
  }

  if (handoffState.status === "idle") return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Purchase handoff</h2><p className="mt-2 text-sm text-slate-700">handoff状態の表示には在庫・仕入・マスター参照権限が必要です。</p></section>;
  if (handoffState.status === "loading") return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Purchase handoff</h2><p className="mt-2 text-sm text-slate-700" role="status">handoff状態を確認しています…</p></section>;
  if (handoffState.status === "error") return <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6"><h2 className="text-lg font-bold text-red-950">Purchase handoffを確認できません</h2><p className="mt-2 text-sm text-red-900" role="alert">{handoffState.message}</p><p className="mt-2 text-sm text-red-900">状態を安全に確認できるまで、Purchase下書きは作成しません。</p></section>;
  if (handoffState.handoff !== null) return <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6"><h2 className="text-lg font-bold text-emerald-950">Purchase handoff済み</h2><p className="mt-2 text-sm text-emerald-900">このrecommendationは、既存のPurchase下書きへ一度だけ引き渡されています。</p><dl className="mt-4 grid gap-4 sm:grid-cols-2"><Fact label="Purchase状態" value={purchaseStatusLabel(handoffState.handoff.purchase.status)} /><Fact label="仕入日" value={formatPurchaseDate(handoffState.handoff.purchase.purchaseDate)} /><Fact label="引渡し時刻" value={handoffState.handoff.createdAt} /><Fact label="PurchaseItem ID" value={handoffState.handoff.purchaseItem.id} /></dl><Link className="mt-5 inline-flex rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800" href={`/purchases/${encodeURIComponent(handoffState.handoff.purchase.id)}`}>Purchase詳細を開く</Link></section>;
  if (!canCreateHandoff) return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">Purchase handoff</h2><p className="mt-2 text-sm text-slate-700">Purchase下書きの作成には、補充管理と仕入書込を含む必要な権限が必要です。</p></section>;
  if (recommendation.disposition !== "ACTIVE" || recommendation.freshness !== "CURRENT") return <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6"><h2 className="text-lg font-bold text-amber-950">Purchase handoffはできません</h2><p className="mt-2 text-sm text-amber-900">ACTIVEかつCURRENTのrecommendationだけをPurchase下書きへ引き渡せます。現在の状態を確認し、必要なら明示的に再計算してください。</p></section>;
  return <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6"><h2 className="text-lg font-bold text-emerald-950">Purchase下書きを作成</h2><p className="mt-2 text-sm text-emerald-900">仕入日時は業務上の取引日時です。UTCのcanonical ISO timestampとして明示的に指定してください。現在のcommercial termsをサーバーが再検証して、不変のlineageとともに下書きを作成します。</p><form className="mt-5 flex flex-wrap items-end gap-3" noValidate onSubmit={submit}><label className="grid gap-1 text-sm font-medium text-emerald-950" htmlFor="recommendation-purchase-date">仕入日時（UTC）<input aria-describedby={dateError === null ? undefined : "recommendation-purchase-date-error"} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm text-slate-950" id="recommendation-purchase-date" onChange={(event) => { setPurchaseDate(event.target.value); setDateError(null); }} placeholder="2026-09-15T00:00:00.000Z" required value={purchaseDate} /></label><button className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "作成しています…" : "Purchase下書きを作成"}</button></form>{dateError !== null && <p className="mt-3 text-sm text-red-900" id="recommendation-purchase-date-error" role="alert">{dateError}</p>}</section>;
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 break-words font-medium text-slate-950">{value}</dd></div>; }
function quantity(value: string | null, unit: string): string { return value === null ? "—" : `${value} ${unit}`; }
function dispositionLabel(value: ReplenishmentRecommendation["disposition"]): string { return value === "ACTIVE" ? "有効" : value === "SUPERSEDED" ? "再計算により置換済み" : "却下済み"; }
function freshnessLabel(value: ReplenishmentRecommendation["freshness"]): string { return value === "CURRENT" ? "現在の入力と一致" : value === "STALE" ? "入力が変化（再計算が必要）" : "現在は計算可能ではない"; }
function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry(): void }>) { return <section className="mt-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-bold text-red-950">補充recommendationを表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={onRetry} type="button">再試行</button></section>; }
