"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  createReplenishmentPolicy,
  requestReplenishmentPolicyContext,
  updateReplenishmentPolicy,
  validateReorderPointQuantity,
  validateTargetStockQuantity,
  type ReplenishmentPolicyContext,
} from "@/lib/replenishment-policy";
import { formatOperationalDate } from "@/lib/products";
import { MasterNavigation } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type PageState =
  | { status: "loading" }
  | { status: "ready"; context: ReplenishmentPolicyContext }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function ReplenishmentPolicyPage({ productId }: Readonly<{ productId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [reorderPointQuantity, setReorderPointQuantity] = useState("");
  const [targetStockQuantity, setTargetStockQuantity] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void requestReplenishmentPolicyContext(api, productId).then((context) => {
      if (!active) return;
      setReorderPointQuantity(context.policy?.reorderPointQuantity ?? "");
      setTargetStockQuantity(context.policy?.targetStockQuantity ?? "");
      setState({ status: "ready", context });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") {
        refreshAuthentication();
        window.location.assign("/forbidden");
        return;
      }
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: error instanceof ApiError ? error.message : "補充ポリシーを読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, productId, refreshAuthentication, retryKey]);

  async function submit() {
    if (state.status !== "ready" || isSubmitting) return;
    const nextReorderPointQuantity = reorderPointQuantity.trim();
    const nextTargetStockQuantity = targetStockQuantity.trim() === "" ? null : targetStockQuantity.trim();
    const validationError = validateReorderPointQuantity(nextReorderPointQuantity)
      ?? validateTargetStockQuantity(nextReorderPointQuantity, nextTargetStockQuantity);
    setFormError(validationError);
    if (validationError !== null) return;
    setIsSubmitting(true);
    try {
      const policy = state.context.policy === null
        ? await createReplenishmentPolicy(api, productId, nextReorderPointQuantity, nextTargetStockQuantity)
        : await updateReplenishmentPolicy(api, productId, nextReorderPointQuantity, nextTargetStockQuantity, state.context.policy.version);
      // The server mutation response is the sole lifecycle authority. Do not
      // issue a follow-up GET merely to infer whether the save succeeded.
      setReorderPointQuantity(policy.reorderPointQuantity);
      setTargetStockQuantity(policy.targetStockQuantity ?? "");
      setState({ status: "ready", context: { ...state.context, policy } });
      setFormError(null);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "forbidden") {
        refreshAuthentication();
        window.location.assign("/forbidden");
        return;
      }
      if (error instanceof ApiError && error.kind === "conflict") {
        setFormError("別の変更または商品状態の変更を検出しました。再読み込み後に内容を確認してください。");
        return;
      }
      setFormError(error instanceof ApiError ? error.message : "補充ポリシーを保存できませんでした。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">補充ポリシーを読み込んでいます…</p>;
  if (state.status === "not_found") return <NotFound />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={() => { setState({ status: "loading" }); setRetryKey((value) => value + 1); }} />;

  const { product, policy } = state.context;
  const editable = permissions.has("master.write") && product.status === "ACTIVE" && !product.isDeleted;
  return (
    <section aria-labelledby="replenishment-policy-title" className="max-w-3xl">
      <MasterNavigation />
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/products/${encodeURIComponent(product.id)}`}>← 商品詳細</Link>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <p className="font-mono text-sm text-slate-600">{product.code}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="replenishment-policy-title">補充ポリシー</h1>
        <p className="mt-2 text-sm text-slate-700">{product.name}に対して、人間が決めた補充点を保存します。補充候補、推奨発注量、入荷予定や不足判定は計算しません。</p>
        <dl className="mt-6 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2">
          <Detail label="在庫単位" value={`${product.inventoryUnit.name}（${product.inventoryUnit.symbol}）`} />
          <Detail label="商品状態" value={product.isDeleted ? "削除済み" : product.status === "ACTIVE" ? "有効" : "無効"} />
          <Detail label="設定状態" value={policy === null ? "未設定" : "設定済み"} />
          {policy !== null && <Detail label="最終更新" value={formatOperationalDate(policy.updatedAt)} />}
        </dl>
      </div>
      {editable ? (
        <form className="mt-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <h2 className="text-lg font-bold text-slate-950">{policy === null ? "補充点を設定" : "補充点を変更"}</h2>
          <p className="mt-2 text-sm text-slate-700">補充点はこの商品の在庫単位で保存されます。数量0は設定済みの有効値であり、未設定とは異なります。</p>
          {formError !== null && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">{formError}</p>}
          <label className="mt-5 grid max-w-sm gap-1 text-sm font-medium text-slate-800" htmlFor="reorder-point-quantity">
            補充点（{product.inventoryUnit.symbol}）
            <input className="rounded-md border border-slate-300 px-3 py-2 text-slate-950" id="reorder-point-quantity" inputMode="decimal" onChange={(event) => setReorderPointQuantity(event.target.value)} value={reorderPointQuantity} />
          </label>
          <label className="mt-5 grid max-w-sm gap-1 text-sm font-medium text-slate-800" htmlFor="target-stock-quantity">
            目標在庫（{product.inventoryUnit.symbol}）
            <input className="rounded-md border border-slate-300 px-3 py-2 text-slate-950" id="target-stock-quantity" inputMode="decimal" onChange={(event) => setTargetStockQuantity(event.target.value)} value={targetStockQuantity} />
            <span className="text-xs font-normal text-slate-600">補充判断時に目標とする在庫数量です。自動的な発注数量ではありません。</span>
          </label>
          <button className="mt-5 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">{isSubmitting ? "保存しています…" : policy === null ? "補充点を設定" : "変更を保存"}</button>
        </form>
      ) : (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          {permissions.has("master.write") ? "無効または削除済みの商品には補充ポリシーを設定・変更できません。" : "補充ポリシーの変更にはマスター更新権限が必要です。"}
        </section>
      )}
      {policy !== null && <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold text-slate-950">現在の設定</h2><p className="mt-3 text-sm text-slate-700">補充点: <span className="font-medium text-slate-950">{policy.reorderPointQuantity} {product.inventoryUnit.symbol}</span></p><p className="mt-2 text-sm text-slate-700">目標在庫: <span className="font-medium text-slate-950">{policy.targetStockQuantity === null ? "未設定" : `${policy.targetStockQuantity} ${product.inventoryUnit.symbol}`}</span></p><p className="mt-2 text-xs text-slate-600">保存バージョン: {policy.version}</p></section>}
    </section>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt className="text-sm font-medium text-slate-600">{label}</dt><dd className="mt-1 text-sm text-slate-950">{value}</dd></div>; }
function NotFound() { return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">商品が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/products">商品一覧へ戻る</Link></section>; }
function ErrorState({ message, onRetry }: Readonly<{ message: string; onRetry(): void }>) { return <section className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><h1 className="text-xl font-bold text-red-950">補充ポリシーを表示できません</h1><p className="mt-3 text-sm text-red-900" role="alert">{message}</p><button className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={onRetry} type="button">再試行</button></section>; }
