"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { formatOperationalDate, isProduct, productStatusLabel, type Product } from "@/lib/products";
import { useOperationalApp } from "./operational-app";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; product: Product }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function ProductDetailPage({ productId }: Readonly<{ productId: string }>) {
  const { api, refreshAuthentication } = useOperationalApp();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void api.request<unknown>(`/products/${encodeURIComponent(productId)}`).then((payload) => {
      if (!isProduct(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", product: payload });
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
      setState({
        status: "error",
        message: error instanceof ApiError ? error.message : "商品情報を読み込めませんでした。",
      });
    });
    return () => {
      active = false;
    };
  }, [api, productId, refreshAuthentication, retryKey]);

  function retry() {
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  if (state.status === "loading") {
    return <p className="text-sm text-slate-700" role="status">商品情報を読み込んでいます…</p>;
  }

  if (state.status === "not_found") {
    return (
      <section aria-labelledby="product-not-found-title" className="max-w-xl rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950" id="product-not-found-title">商品が見つかりません</h1>
        <p className="mt-3 text-sm text-slate-700">指定された商品は存在しないか、現在は参照できません。</p>
        <Link className="mt-6 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/products">商品一覧へ戻る</Link>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section aria-labelledby="product-error-title" className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6">
        <h1 className="text-xl font-semibold text-red-950" id="product-error-title">商品情報を表示できません</h1>
        <p className="mt-3 text-sm text-red-900" role="alert">{state.message}</p>
        <button
          className="mt-5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          onClick={retry}
          type="button"
        >
          再試行
        </button>
      </section>
    );
  }

  const { product } = state;
  return (
    <section aria-labelledby="product-detail-title" className="max-w-3xl">
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/products">← 商品一覧</Link>
      <div className="mt-5 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm text-slate-600">{product.code}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="product-detail-title">{product.name}</h1>
          </div>
          <span className={product.status === "ACTIVE" ? "rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800" : "rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700"}>
            {productStatusLabel(product.status)}
          </span>
        </div>
        <dl className="mt-8 grid gap-x-8 gap-y-6 border-t border-slate-200 pt-6 sm:grid-cols-2">
          <DetailItem label="説明" value={product.description ?? "—"} />
          <DetailItem label="基準単位ID" value={product.baseUnitId} />
          <DetailItem label="在庫単位ID" value={product.inventoryUnitId} />
          <DetailItem label="登録日時" value={formatOperationalDate(product.createdAt)} />
          <DetailItem label="更新日時" value={formatOperationalDate(product.updatedAt)} />
        </dl>
      </div>
    </section>
  );
}

function DetailItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-950">{value}</dd>
    </div>
  );
}
