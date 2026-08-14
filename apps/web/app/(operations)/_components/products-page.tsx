"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { formatOperationalDate, isProductList, productStatusLabel, type Product } from "@/lib/products";
import { useOperationalApp } from "./operational-app";

const PAGE_SIZE = 100;

type ListState =
  | { status: "loading" }
  | { status: "ready"; products: Product[] }
  | { status: "error"; message: string };

export function ProductsPage() {
  const { api, refreshAuthentication } = useOperationalApp();
  const [offset, setOffset] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<ListState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void api.request<unknown>(`/products?limit=${PAGE_SIZE}&offset=${offset}`).then((payload) => {
      if (!isProductList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", products: payload });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") {
        refreshAuthentication();
        window.location.assign("/forbidden");
        return;
      }
      setState({
        status: "error",
        message: error instanceof ApiError ? error.message : "商品マスターを読み込めませんでした。",
      });
    });
    return () => {
      active = false;
    };
  }, [api, offset, refreshAuthentication, retryKey]);

  function retry() {
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  function goToPreviousPage() {
    setState({ status: "loading" });
    setOffset((current) => Math.max(0, current - PAGE_SIZE));
  }

  function goToNextPage() {
    setState({ status: "loading" });
    setOffset((current) => current + PAGE_SIZE);
  }

  return (
    <section aria-labelledby="products-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-700">マスター</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="products-title">商品</h1>
          <p className="mt-2 text-sm text-slate-700">登録済みの商品情報を参照できます。</p>
        </div>
      </div>

      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">商品を読み込んでいます…</p>}

      {state.status === "error" && (
        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-900">{state.message}</p>
          <button
            className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            onClick={retry}
            type="button"
          >
            再試行
          </button>
        </div>
      )}

      {state.status === "ready" && state.products.length === 0 && (
        <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">表示できる商品はありません。</p>
      )}

      {state.status === "ready" && state.products.length > 0 && (
        <>
          <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">コード</th>
                  <th className="px-4 py-3 font-semibold" scope="col">商品名</th>
                  <th className="px-4 py-3 font-semibold" scope="col">状態</th>
                  <th className="px-4 py-3 font-semibold" scope="col">更新日時</th>
                  <th className="px-4 py-3 font-semibold" scope="col"><span className="sr-only">詳細</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.products.map((product) => (
                  <tr className="hover:bg-slate-50" key={product.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{product.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-950">{product.name}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={product.status === "ACTIVE" ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800" : "rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700"}>
                        {productStatusLabel(product.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatOperationalDate(product.updatedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/products/${encodeURIComponent(product.id)}`}>
                        詳細
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-700">
            <p>{offset + 1}件目から表示中</p>
            <div className="flex gap-2">
              <button
                className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                disabled={offset === 0}
                onClick={goToPreviousPage}
                type="button"
              >
                前へ
              </button>
              <button
                className="rounded-md border border-slate-300 px-3 py-2 font-medium hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                disabled={state.products.length < PAGE_SIZE}
                onClick={goToNextPage}
                type="button"
              >
                次へ
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
