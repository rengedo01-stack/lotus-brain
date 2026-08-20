"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  MASTER_STATUSES,
  type FieldErrors,
  type MasterStatus,
  type Supplier,
  isSupplier,
  isSupplierList,
  supplierCreatePayload,
  supplierUpdatePayload,
  validateSupplierCreate,
  validateSupplierEdit,
} from "@/lib/master-data";
import { Field, fieldErrorProps, FormActions, FormError, MasterNavigation, SelectInput, StatusBadge, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type SuppliersState =
  | { status: "loading" }
  | { status: "ready"; suppliers: Supplier[] }
  | { status: "error"; message: string };
type SupplierDetailState =
  | { status: "loading" }
  | { status: "ready"; supplier: Supplier }
  | { status: "not_found" }
  | { status: "error"; message: string };
type SupplierCreateValues = { code: string; name: string; status: MasterStatus };
type SupplierEditValues = Pick<SupplierCreateValues, "name" | "status">;

function handleProtectedError(error: unknown, refreshAuthentication: () => void): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === "unauthorized") return true;
  if (error.kind === "forbidden") { refreshAuthentication(); window.location.assign("/forbidden"); return true; }
  return false;
}

function formErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "保存できませんでした。時間をおいて再試行してください。";
  if (error.kind === "conflict") return "同じコードの仕入先が既に登録されています。";
  if (error.kind === "validation") return "入力内容を確認してください。";
  return error.message;
}

function SupplierFields({ errors, onChange, values, withCode }: Readonly<{
  errors: FieldErrors;
  onChange: (field: "code" | "name" | "status", value: string) => void;
  values: SupplierCreateValues;
  withCode: boolean;
}>) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {withCode && <Field error={errors.code} htmlFor="supplier-code" label="仕入先コード" required><TextInput {...fieldErrorProps("code", "supplier-code", errors)} id="supplier-code" onChange={(event) => onChange("code", event.target.value)} required value={values.code} /></Field>}
      <Field error={errors.name} htmlFor="supplier-name" label="仕入先名" required><TextInput {...fieldErrorProps("name", "supplier-name", errors)} id="supplier-name" onChange={(event) => onChange("name", event.target.value)} required value={values.name} /></Field>
      <Field error={errors.status} htmlFor="supplier-status" label="状態"><SelectInput id="supplier-status" onChange={(event) => onChange("status", event.target.value)} value={values.status}>{MASTER_STATUSES.map((status) => <option key={status} value={status}>{status === "ACTIVE" ? "有効" : "無効"}</option>)}</SelectInput></Field>
    </div>
  );
}

export function SuppliersPage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<SuppliersState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { let active = true; void api.request<unknown>("/suppliers?limit=100&offset=0").then((payload) => { if (!isSupplierList(payload)) throw new ApiError("server"); if (active) setState({ status: "ready", suppliers: payload }); }).catch((error: unknown) => { if (!active || handleProtectedError(error, refreshAuthentication)) return; setState({ status: "error", message: error instanceof ApiError ? error.message : "仕入先を読み込めませんでした。" }); }); return () => { active = false; }; }, [api, refreshAuthentication, retryKey]);
  return <section aria-labelledby="suppliers-title"><MasterNavigation /><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-blue-700">マスター</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="suppliers-title">仕入先</h1><p className="mt-2 text-sm text-slate-700">登録済みの仕入先情報を参照できます。</p></div>{permissions.has("master.write") && <Link className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/suppliers/new">新規作成</Link>}</div>{state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">仕入先を読み込んでいます…</p>}{state.status === "error" && <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4" role="alert"><p className="text-sm text-red-900">{state.message}</p><button className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} type="button">再試行</button></div>}{state.status === "ready" && state.suppliers.length === 0 && <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">表示できる仕入先はありません。</p>}{state.status === "ready" && state.suppliers.length > 0 && <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">コード</th><th className="px-4 py-3 font-semibold">仕入先名</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3"><span className="sr-only">編集</span></th></tr></thead><tbody className="divide-y divide-slate-100">{state.suppliers.map((supplier) => <tr className="hover:bg-slate-50" key={supplier.id}><td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{supplier.code}</td><td className="px-4 py-3 font-medium text-slate-950">{supplier.name}</td><td className="px-4 py-3"><StatusBadge status={supplier.status} /></td><td className="px-4 py-3 text-right">{permissions.has("master.write") && <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/suppliers/${encodeURIComponent(supplier.id)}/edit`}>編集</Link>}</td></tr>)}</tbody></table></div>}</section>;
}

export function SupplierCreatePage() {
  const router = useRouter(); const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [values, setValues] = useState<SupplierCreateValues>({ code: "", name: "", status: "ACTIVE" }); const [errors, setErrors] = useState<FieldErrors>({}); const [formError, setFormError] = useState<string | null>(null); const [isSubmitting, setIsSubmitting] = useState(false);
  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/suppliers" />;
  function change(field: "code" | "name" | "status", value: string) { setValues((current) => ({ ...current, [field]: value } as SupplierCreateValues)); setErrors((current) => ({ ...current, [field]: "" })); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const nextErrors = validateSupplierCreate(values); setErrors(nextErrors); setFormError(null); if (Object.keys(nextErrors).length > 0 || isSubmitting) return; setIsSubmitting(true); try { const created = await api.request<unknown>("/suppliers", { method: "POST", body: supplierCreatePayload(values) }); if (!isSupplier(created)) throw new ApiError("server"); router.replace(`/master/suppliers/${encodeURIComponent(created.id)}/edit`); } catch (error: unknown) { if (!handleProtectedError(error, refreshAuthentication)) setFormError(formErrorMessage(error)); } finally { setIsSubmitting(false); } }
  return <section aria-labelledby="supplier-create-title" className="max-w-3xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="supplier-create-title">仕入先を新規作成</h1><form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => void submit(event)}><FormError message={formError} /><SupplierFields errors={errors} onChange={change} values={values} withCode /><FormActions cancelHref="/master/suppliers" isSubmitting={isSubmitting} submitLabel="仕入先を作成" /></form></section>;
}

export function SupplierEditPage({ supplierId }: Readonly<{ supplierId: string }>) {
  const router = useRouter(); const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<SupplierDetailState>({ status: "loading" }); const [retryKey, setRetryKey] = useState(0); const [values, setValues] = useState<SupplierCreateValues>({ code: "", name: "", status: "ACTIVE" }); const [errors, setErrors] = useState<FieldErrors>({}); const [formError, setFormError] = useState<string | null>(null); const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => { let active = true; void api.request<unknown>(`/suppliers/${encodeURIComponent(supplierId)}`).then((payload) => { if (!isSupplier(payload)) throw new ApiError("server"); if (active) { setState({ status: "ready", supplier: payload }); setValues({ code: payload.code, name: payload.name, status: payload.status }); } }).catch((error: unknown) => { if (!active || handleProtectedError(error, refreshAuthentication)) return; if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" }); else setState({ status: "error", message: error instanceof ApiError ? error.message : "仕入先情報を読み込めませんでした。" }); }); return () => { active = false; }; }, [api, refreshAuthentication, retryKey, supplierId]);
  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/suppliers" />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">仕入先情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">仕入先が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/suppliers">仕入先一覧へ戻る</Link></section>;
  if (state.status === "error") return <section className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900" onClick={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} type="button">再試行</button></section>;
  function change(field: "code" | "name" | "status", value: string) { setValues((current) => ({ ...current, [field]: value } as SupplierCreateValues)); setErrors((current) => ({ ...current, [field]: "" })); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const editValues: SupplierEditValues = { name: values.name, status: values.status }; const nextErrors = validateSupplierEdit(editValues); setErrors(nextErrors); setFormError(null); if (Object.keys(nextErrors).length > 0 || isSubmitting) return; setIsSubmitting(true); try { const updated = await api.request<unknown>(`/suppliers/${encodeURIComponent(supplierId)}`, { method: "PATCH", body: supplierUpdatePayload(editValues) }); if (!isSupplier(updated)) throw new ApiError("server"); router.replace("/master/suppliers"); } catch (error: unknown) { if (!handleProtectedError(error, refreshAuthentication)) setFormError(formErrorMessage(error)); } finally { setIsSubmitting(false); } }
  return <section aria-labelledby="supplier-edit-title" className="max-w-3xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="supplier-edit-title">仕入先を編集</h1><p className="mt-2 text-sm text-slate-700">仕入先コードは変更できません。</p><form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => void submit(event)}><FormError message={formError} /><div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm"><p className="font-medium text-slate-600">仕入先コード</p><p className="mt-1 font-mono text-slate-950">{state.supplier.code}</p></div><SupplierFields errors={errors} onChange={change} values={values} withCode={false} /><FormActions cancelHref="/master/suppliers" isSubmitting={isSubmitting} submitLabel="変更を保存" /></form></section>;
}
