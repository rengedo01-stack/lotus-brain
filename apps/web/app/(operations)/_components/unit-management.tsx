"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  MASTER_STATUSES,
  UNIT_DIMENSIONS,
  type FieldErrors,
  type MasterStatus,
  type Unit,
  isUnit,
  isUnitList,
  unitCreatePayload,
  unitDimensionLabel,
  unitStatusUpdatePayload,
  validateUnitCreate,
} from "@/lib/master-data";
import { Field, fieldErrorProps, FormActions, FormError, MasterNavigation, SelectInput, StatusBadge, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type UnitsState =
  | { status: "loading" }
  | { status: "ready"; units: Unit[] }
  | { status: "error"; message: string };

type UnitDetailState =
  | { status: "loading" }
  | { status: "ready"; unit: Unit }
  | { status: "not_found" }
  | { status: "error"; message: string };

type UnitFormValues = {
  code: string;
  dimension: "COUNT" | "MASS" | "VOLUME";
  name: string;
  status: MasterStatus;
  symbol: string;
};

const emptyUnitForm: UnitFormValues = { code: "", name: "", symbol: "", dimension: "COUNT", status: "ACTIVE" };

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

function formErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "保存できませんでした。時間をおいて再試行してください。";
  if (error.kind === "conflict") return "同じコードの単位が既に登録されています。";
  if (error.kind === "validation") return "入力内容を確認してください。";
  return error.message;
}

export function UnitsPage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<UnitsState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    void api.request<unknown>("/units?limit=100&offset=0").then((payload) => {
      if (!isUnitList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", units: payload });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      setState({ status: "error", message: error instanceof ApiError ? error.message : "単位を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey]);

  return (
    <section aria-labelledby="units-title">
      <MasterNavigation />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm font-medium text-blue-700">マスター</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="units-title">単位</h1><p className="mt-2 text-sm text-slate-700">単位の意味フィールドは登録後に変更できません。</p></div>
        {permissions.has("master.write") && <Link className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/master/units/new">新規作成</Link>}
      </div>
      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">単位を読み込んでいます…</p>}
      {state.status === "error" && <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4" role="alert"><p className="text-sm text-red-900">{state.message}</p><button className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} type="button">再試行</button></div>}
      {state.status === "ready" && state.units.length === 0 && <p className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">表示できる単位はありません。</p>}
      {state.status === "ready" && state.units.length > 0 && <div className="mt-8 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">コード</th><th className="px-4 py-3 font-semibold">単位名</th><th className="px-4 py-3 font-semibold">記号</th><th className="px-4 py-3 font-semibold">次元</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3"><span className="sr-only">編集</span></th></tr></thead><tbody className="divide-y divide-slate-100">{state.units.map((unit) => <tr className="hover:bg-slate-50" key={unit.id}><td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{unit.code}</td><td className="px-4 py-3 font-medium text-slate-950">{unit.name}</td><td className="px-4 py-3 text-slate-700">{unit.symbol}</td><td className="px-4 py-3 text-slate-700">{unitDimensionLabel(unit.dimension)}</td><td className="px-4 py-3"><StatusBadge status={unit.status} /></td><td className="px-4 py-3 text-right">{permissions.has("master.write") && <Link className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href={`/master/units/${encodeURIComponent(unit.id)}/edit`}>状態を編集</Link>}</td></tr>)}</tbody></table></div>}
    </section>
  );
}

export function UnitCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [values, setValues] = useState<UnitFormValues>(emptyUnitForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/units" />;

  function change(field: keyof UnitFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value } as UnitFormValues));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateUnitCreate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/units", { method: "POST", body: unitCreatePayload(values) });
      if (!isUnit(created)) throw new ApiError("server");
      router.replace(`/master/units/${encodeURIComponent(created.id)}/edit`);
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(formErrorMessage(error));
    } finally { setIsSubmitting(false); }
  }

  return <section aria-labelledby="unit-create-title" className="max-w-3xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="unit-create-title">単位を新規作成</h1><p className="mt-2 text-sm text-slate-700">コード、名称、記号、次元は登録後に変更できません。</p><form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" noValidate onSubmit={(event) => void submit(event)}><FormError message={formError} /><div className="grid gap-5 sm:grid-cols-2"><Field error={errors.code} htmlFor="unit-code" label="単位コード" required><TextInput {...fieldErrorProps("code", "unit-code", errors)} id="unit-code" onChange={(event) => change("code", event.target.value)} required value={values.code} /></Field><Field error={errors.name} htmlFor="unit-name" label="単位名" required><TextInput {...fieldErrorProps("name", "unit-name", errors)} id="unit-name" onChange={(event) => change("name", event.target.value)} required value={values.name} /></Field><Field error={errors.symbol} htmlFor="unit-symbol" label="記号" required><TextInput {...fieldErrorProps("symbol", "unit-symbol", errors)} id="unit-symbol" onChange={(event) => change("symbol", event.target.value)} required value={values.symbol} /></Field><Field error={errors.dimension} htmlFor="unit-dimension" label="次元" required><SelectInput id="unit-dimension" onChange={(event) => change("dimension", event.target.value)} value={values.dimension}>{UNIT_DIMENSIONS.map((dimension) => <option key={dimension} value={dimension}>{unitDimensionLabel(dimension)}</option>)}</SelectInput></Field><Field error={errors.status} htmlFor="unit-status" label="状態"><SelectInput id="unit-status" onChange={(event) => change("status", event.target.value)} value={values.status}>{MASTER_STATUSES.map((status) => <option key={status} value={status}>{status === "ACTIVE" ? "有効" : "無効"}</option>)}</SelectInput></Field></div><FormActions cancelHref="/master/units" isSubmitting={isSubmitting} submitLabel="単位を作成" /></form></section>;
}

export function UnitEditPage({ unitId }: Readonly<{ unitId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<UnitDetailState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [status, setStatus] = useState<MasterStatus>("ACTIVE");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    void api.request<unknown>(`/units/${encodeURIComponent(unitId)}`).then((payload) => {
      if (!isUnit(payload)) throw new ApiError("server");
      if (active) { setState({ status: "ready", unit: payload }); setStatus(payload.status); }
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" });
      else setState({ status: "error", message: error instanceof ApiError ? error.message : "単位情報を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, retryKey, unitId]);
  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/units" />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">単位情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">単位が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/units">単位一覧へ戻る</Link></section>;
  if (state.status === "error") return <section className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900" onClick={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} type="button">再試行</button></section>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true); setFormError(null);
    try {
      const updated = await api.request<unknown>(`/units/${encodeURIComponent(unitId)}`, { method: "PATCH", body: unitStatusUpdatePayload(status) });
      if (!isUnit(updated)) throw new ApiError("server");
      router.replace("/master/units");
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(formErrorMessage(error));
    } finally { setIsSubmitting(false); }
  }

  return <section aria-labelledby="unit-edit-title" className="max-w-3xl"><MasterNavigation /><h1 className="text-3xl font-bold tracking-tight text-slate-950" id="unit-edit-title">単位の状態を編集</h1><p className="mt-2 text-sm text-slate-700">単位のコード、名称、記号、次元は変更できません。</p><form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" onSubmit={(event) => void submit(event)}><FormError message={formError} /><dl className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="font-medium text-slate-600">単位コード</dt><dd className="mt-1 font-mono text-slate-950">{state.unit.code}</dd></div><div><dt className="font-medium text-slate-600">単位名</dt><dd className="mt-1 text-slate-950">{state.unit.name}</dd></div><div><dt className="font-medium text-slate-600">記号</dt><dd className="mt-1 text-slate-950">{state.unit.symbol}</dd></div><div><dt className="font-medium text-slate-600">次元</dt><dd className="mt-1 text-slate-950">{unitDimensionLabel(state.unit.dimension)}</dd></div></dl><Field htmlFor="unit-edit-status" label="状態"><SelectInput id="unit-edit-status" onChange={(event) => setStatus(event.target.value as MasterStatus)} value={status}>{MASTER_STATUSES.map((candidate) => <option key={candidate} value={candidate}>{candidate === "ACTIVE" ? "有効" : "無効"}</option>)}</SelectInput></Field><FormActions cancelHref="/master/units" isSubmitting={isSubmitting} submitLabel="状態を保存" /></form></section>;
}
