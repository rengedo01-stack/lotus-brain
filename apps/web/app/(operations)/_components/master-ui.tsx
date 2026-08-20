"use client";

import Link from "next/link";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { FieldErrors, MasterStatus } from "@/lib/master-data";

const inputClassName = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100";

export function MasterNavigation() {
  return (
    <nav aria-label="マスター管理" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
      <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/products">商品</Link>
      <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/units">単位</Link>
      <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/suppliers">仕入先</Link>
    </nav>
  );
}

export function StatusBadge({ status }: Readonly<{ status: MasterStatus }>) {
  return (
    <span className={status === "ACTIVE" ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800" : "rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700"}>
      {status === "ACTIVE" ? "有効" : "無効"}
    </span>
  );
}

export function Field({ children, error, htmlFor, label, required = false }: Readonly<{
  children: ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
  required?: boolean;
}>) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-900" htmlFor={htmlFor}>
        {label}{required && <span aria-hidden="true" className="ml-1 text-red-700">*</span>}
      </label>
      {children}
      {error !== undefined && error.length > 0 && <p className="mt-1 text-sm text-red-800" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  );
}

export function TextInput(props: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  const { className, ...rest } = props;
  return <input className={`${inputClassName} ${className ?? ""}`} {...rest} />;
}

export function TextArea(props: Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const { className, ...rest } = props;
  return <textarea className={`${inputClassName} ${className ?? ""}`} {...rest} />;
}

export function SelectInput(props: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  const { className, ...rest } = props;
  return <select className={`${inputClassName} ${className ?? ""}`} {...rest} />;
}

export function FormError({ message }: Readonly<{ message: string | null }>) {
  if (message === null) return null;
  return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">{message}</p>;
}

export function FormActions({ cancelHref, isSubmitting, submitLabel }: Readonly<{ cancelHref: string; isSubmitting: boolean; submitLabel: string }>) {
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={isSubmitting} type="submit">
        {isSubmitting ? "保存しています…" : submitLabel}
      </button>
      <Link className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={cancelHref}>キャンセル</Link>
    </div>
  );
}

export function WriteAccessRequired({ backHref }: Readonly<{ backHref: string }>) {
  return (
    <section aria-labelledby="write-access-required-title" className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-xl font-bold text-amber-950" id="write-access-required-title">編集権限がありません</h1>
      <p className="mt-3 text-sm text-amber-900">この画面での作成・編集にはマスター書込権限が必要です。</p>
      <Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={backHref}>一覧へ戻る</Link>
    </section>
  );
}

export function fieldErrorProps(field: string, htmlFor: string, errors: FieldErrors) {
  return errors[field] === undefined || errors[field].length === 0 ? {} : { "aria-describedby": `${htmlFor}-error`, "aria-invalid": true };
}
