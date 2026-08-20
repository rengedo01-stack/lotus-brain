"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  MASTER_STATUSES,
  type FieldErrors,
  type MasterStatus,
  type Unit,
  isUnitList,
  productCreatePayload,
  productUpdatePayload,
  validateProductCreate,
  validateProductEdit,
} from "@/lib/master-data";
import { isProduct, type Product } from "@/lib/products";
import { Field, fieldErrorProps, FormActions, FormError, MasterNavigation, SelectInput, TextArea, TextInput, WriteAccessRequired } from "./master-ui";
import { useOperationalApp } from "./operational-app";

type ProductFormValues = {
  baseUnitId: string;
  code: string;
  description: string;
  inventoryUnitId: string;
  name: string;
  status: MasterStatus;
};

type UnitsState =
  | { status: "loading" }
  | { status: "ready"; units: Unit[] }
  | { status: "error"; message: string };

const emptyProductForm: ProductFormValues = {
  code: "",
  name: "",
  description: "",
  baseUnitId: "",
  inventoryUnitId: "",
  status: "ACTIVE",
};

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "保存できませんでした。時間をおいて再試行してください。";
  if (error.kind === "conflict") return "同じコードの商品が既に登録されています。";
  if (error.kind === "validation") return "入力内容を確認してください。";
  return error.message;
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

function useUnits() {
  const { api, refreshAuthentication } = useOperationalApp();
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<UnitsState>({ status: "loading" });

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

  return { retry: () => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }, state };
}

function ProductFields({ errors, onChange, units, values, withUnits }: Readonly<{
  errors: FieldErrors;
  onChange: (field: keyof ProductFormValues, value: string) => void;
  units?: Unit[];
  values: ProductFormValues;
  withUnits: boolean;
}>) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {withUnits && (
        <Field error={errors.code} htmlFor="product-code" label="商品コード" required>
          <TextInput {...fieldErrorProps("code", "product-code", errors)} id="product-code" onChange={(event) => onChange("code", event.target.value)} required value={values.code} />
        </Field>
      )}
      <Field error={errors.name} htmlFor="product-name" label="商品名" required>
        <TextInput {...fieldErrorProps("name", "product-name", errors)} id="product-name" onChange={(event) => onChange("name", event.target.value)} required value={values.name} />
      </Field>
      {withUnits && (
        <>
          <Field error={errors.baseUnitId} htmlFor="product-base-unit" label="基準単位" required>
            <SelectInput {...fieldErrorProps("baseUnitId", "product-base-unit", errors)} id="product-base-unit" onChange={(event) => onChange("baseUnitId", event.target.value)} required value={values.baseUnitId}>
              <option value="">選択してください</option>
              {units?.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}) {unit.status === "INACTIVE" ? "[無効]" : ""}</option>)}
            </SelectInput>
          </Field>
          <Field error={errors.inventoryUnitId} htmlFor="product-inventory-unit" label="在庫単位" required>
            <SelectInput {...fieldErrorProps("inventoryUnitId", "product-inventory-unit", errors)} id="product-inventory-unit" onChange={(event) => onChange("inventoryUnitId", event.target.value)} required value={values.inventoryUnitId}>
              <option value="">選択してください</option>
              {units?.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name} ({unit.symbol}) {unit.status === "INACTIVE" ? "[無効]" : ""}</option>)}
            </SelectInput>
          </Field>
        </>
      )}
      <Field error={errors.status} htmlFor="product-status" label="状態">
        <SelectInput id="product-status" onChange={(event) => onChange("status", event.target.value)} value={values.status}>
          {MASTER_STATUSES.map((status) => <option key={status} value={status}>{status === "ACTIVE" ? "有効" : "無効"}</option>)}
        </SelectInput>
      </Field>
      <div className="sm:col-span-2">
        <Field error={errors.description} htmlFor="product-description" label="説明">
          <TextArea id="product-description" onChange={(event) => onChange("description", event.target.value)} rows={4} value={values.description} />
        </Field>
      </div>
    </div>
  );
}

export function ProductCreatePage() {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const { retry, state: unitsState } = useUnits();
  const [values, setValues] = useState<ProductFormValues>(emptyProductForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!permissions.has("master.write")) return <WriteAccessRequired backHref="/master/products" />;

  function change(field: keyof ProductFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProductCreate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await api.request<unknown>("/products", { method: "POST", body: productCreatePayload(values) });
      if (!isProduct(created)) throw new ApiError("server");
      router.replace(`/master/products/${encodeURIComponent(created.id)}`);
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="product-create-title" className="max-w-3xl">
      <MasterNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="product-create-title">商品を新規作成</h1>
      <p className="mt-2 text-sm text-slate-700">基準単位と在庫単位は商品登録後に変更できません。</p>
      {unitsState.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">単位を読み込んでいます…</p>}
      {unitsState.status === "error" && <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4" role="alert"><p className="text-sm text-red-900">{unitsState.message}</p><button className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></div>}
      {unitsState.status === "ready" && (
        <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" onSubmit={(event) => void submit(event)} noValidate>
          <FormError message={formError} />
          <ProductFields errors={errors} onChange={change} units={unitsState.units} values={values} withUnits />
          <FormActions cancelHref="/master/products" isSubmitting={isSubmitting} submitLabel="商品を作成" />
        </form>
      )}
    </section>
  );
}

type ProductEditState =
  | { status: "loading" }
  | { status: "ready"; product: Product }
  | { status: "not_found" }
  | { status: "error"; message: string };

export function ProductEditPage({ productId }: Readonly<{ productId: string }>) {
  const router = useRouter();
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const [state, setState] = useState<ProductEditState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [values, setValues] = useState<ProductFormValues>(emptyProductForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void api.request<unknown>(`/products/${encodeURIComponent(productId)}`).then((payload) => {
      if (!isProduct(payload)) throw new ApiError("server");
      if (!active) return;
      setState({ status: "ready", product: payload });
      setValues({ code: payload.code, name: payload.name, description: payload.description ?? "", baseUnitId: payload.baseUnitId, inventoryUnitId: payload.inventoryUnitId, status: payload.status });
    }).catch((error: unknown) => {
      if (!active || handleProtectedError(error, refreshAuthentication)) return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" });
      else setState({ status: "error", message: error instanceof ApiError ? error.message : "商品情報を読み込めませんでした。" });
    });
    return () => { active = false; };
  }, [api, productId, refreshAuthentication, retryKey]);

  if (!permissions.has("master.write")) return <WriteAccessRequired backHref={`/master/products/${encodeURIComponent(productId)}`} />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">商品情報を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="max-w-xl rounded-xl bg-white p-6 shadow-sm"><h1 className="text-2xl font-bold text-slate-950">商品が見つかりません</h1><Link className="mt-5 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/master/products">商品一覧へ戻る</Link></section>;
  if (state.status === "error") return <section className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6"><p className="text-sm text-red-900" role="alert">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900" onClick={() => { setState({ status: "loading" }); setRetryKey((current) => current + 1); }} type="button">再試行</button></section>;

  function change(field: keyof ProductFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProductEdit(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/products/${encodeURIComponent(productId)}`, { method: "PATCH", body: productUpdatePayload(values) });
      if (!isProduct(updated)) throw new ApiError("server");
      router.replace(`/master/products/${encodeURIComponent(updated.id)}`);
    } catch (error: unknown) {
      if (!handleProtectedError(error, refreshAuthentication)) setFormError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="product-edit-title" className="max-w-3xl">
      <MasterNavigation />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="product-edit-title">商品を編集</h1>
      <p className="mt-2 text-sm text-slate-700">商品コード、基準単位、在庫単位は変更できません。</p>
      <form className="mt-8 space-y-6 rounded-xl bg-white p-6 shadow-sm" onSubmit={(event) => void submit(event)} noValidate>
        <FormError message={formError} />
        <ProductFields errors={errors} onChange={change} values={values} withUnits={false} />
        <dl className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><dt className="font-medium text-slate-600">商品コード</dt><dd className="mt-1 font-mono text-slate-950">{state.product.code}</dd></div><div><dt className="font-medium text-slate-600">基準単位ID</dt><dd className="mt-1 break-words text-slate-950">{state.product.baseUnitId}</dd></div><div><dt className="font-medium text-slate-600">在庫単位ID</dt><dd className="mt-1 break-words text-slate-950">{state.product.inventoryUnitId}</dd></div></dl>
        <FormActions cancelHref={`/master/products/${encodeURIComponent(productId)}`} isSubmitting={isSubmitting} submitLabel="変更を保存" />
      </form>
    </section>
  );
}
