"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  appendRole,
  customRoleCreatePayload,
  customRoleUpdatePayload,
  customRoleUpdateValues,
  grantPermissionLocally,
  grantRoleLocally,
  initialCustomRoleFormValues,
  isAuthorizationPermissionList,
  isAuthorizationRole,
  isAuthorizationRoleList,
  type AuthorizationPermission,
  type AuthorizationRole,
  type AuthorizationFieldErrors,
  type CustomRoleFormValues,
  type CustomRoleUpdateValues,
  type RoleStatus,
  revokePermissionLocally,
  revokeRoleLocally,
  roleStatusLabel,
  validateCustomRoleCreate,
  validateCustomRoleUpdate,
} from "@/lib/authorization";
import { isIdentityUserList, type IdentityUser } from "@/lib/identity";
import { useOperationalApp } from "./operational-app";

type WorkspaceState =
  | { status: "loading" }
  | { status: "ready"; permissions: AuthorizationPermission[]; roles: AuthorizationRole[] }
  | { message: string; status: "error" };

type RoleDetailState =
  | { status: "loading" }
  | { status: "not_found" }
  | { message: string; status: "error" }
  | {
    assignedPermissions: AuthorizationPermission[];
    catalog: AuthorizationPermission[];
    role: AuthorizationRole;
    status: "ready";
  };

type DirectoryState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "ready"; users: IdentityUser[] }
  | { message: string; status: "error" };

type UserRoleState =
  | { status: "idle" }
  | { status: "loading" }
  | { roles: AuthorizationRole[]; status: "ready" }
  | { message: string; status: "error" };

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "認可情報を処理できませんでした。時間をおいて再試行してください。";
}

function handleAuthorizationError(error: unknown, refreshAuthentication: () => void): "unauthorized" | "forbidden" | "other" {
  if (!(error instanceof ApiError)) return "other";
  if (error.kind === "unauthorized") return "unauthorized";
  if (error.kind === "forbidden") {
    // A 403 is an authorization change, not a session failure. Rebootstrap only refreshes UX state.
    refreshAuthentication();
    return "forbidden";
  }
  return "other";
}

function isStaleMutationError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === "conflict" || error.kind === "not_found");
}

function RoleStatusBadge({ status }: Readonly<{ status: RoleStatus }>) {
  const className = status === "ACTIVE"
    ? "bg-emerald-100 text-emerald-900"
    : "bg-slate-200 text-slate-800";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{roleStatusLabel(status)}</span>;
}

function SystemRoleBadge() {
  return <span className="inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-900">システム保護</span>;
}

function LoadError({ message, retry }: Readonly<{ message: string; retry: () => void }>) {
  return (
    <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm text-red-900">{message}</p>
      <button className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button>
    </div>
  );
}

function ReadAccessRequired() {
  return (
    <section aria-labelledby="authorization-read-required-title" className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-xl font-bold text-amber-950" id="authorization-read-required-title">認可構成を表示できません</h1>
      <p className="mt-3 text-sm text-amber-900">この画面には authorization.read が必要です。権限の最終判定は常にAPIで行われます。</p>
    </section>
  );
}

export function AuthorizationWorkspacePage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const canRead = permissions.has("authorization.read");
  const canManage = permissions.has("authorization.manage");
  const [state, setState] = useState<WorkspaceState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [values, setValues] = useState<CustomRoleFormValues>(initialCustomRoleFormValues);
  const [errors, setErrors] = useState<AuthorizationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.all([
      api.request<unknown>("/authorization/roles"),
      api.request<unknown>("/authorization/permissions"),
    ]).then(([rolesPayload, permissionsPayload]) => {
      if (!isAuthorizationRoleList(rolesPayload) || !isAuthorizationPermissionList(permissionsPayload)) throw new ApiError("server");
      if (active) setState({ status: "ready", roles: rolesPayload, permissions: permissionsPayload });
    }).catch((error: unknown) => {
      if (!active || handleAuthorizationError(error, refreshAuthentication) === "unauthorized") return;
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canRead, refreshAuthentication, retryKey]);

  function reload() {
    setSuccess(null);
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCustomRoleCreate(values);
    setErrors(nextErrors);
    setFormError(null);
    setSuccess(null);
    if (Object.keys(nextErrors).length > 0 || isSubmitting || !canManage) return;

    setIsSubmitting(true);
    try {
      const payload = await api.request<unknown>("/authorization/roles", {
        method: "POST",
        body: customRoleCreatePayload(values),
      });
      if (!isAuthorizationRole(payload) || payload.isSystem) throw new ApiError("server");
      setState((current) => current.status === "ready"
        ? { ...current, roles: appendRole(current.roles, payload) }
        : current);
      setValues(initialCustomRoleFormValues());
      setSuccess(`カスタムロール「${payload.name}」を作成しました。`);
    } catch (error: unknown) {
      const kind = handleAuthorizationError(error, refreshAuthentication);
      if (kind !== "unauthorized" && kind !== "forbidden") setFormError(errorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!canRead) return <ReadAccessRequired />;
  return (
    <section aria-labelledby="authorization-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-700">管理</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="authorization-title">認可管理</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">ロールと既知の権限を確認します。システムロールは表示専用で、カスタムロールだけを管理できます。</p>
        </div>
        <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" onClick={reload} type="button">最新状態を再読み込み</button>
      </div>
      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">認可構成を読み込んでいます…</p>}
      {state.status === "error" && <LoadError message={state.message} retry={reload} />}
      {state.status === "ready" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(19rem,0.7fr)]">
          <section aria-labelledby="role-list-title" className="rounded-xl bg-white p-5 shadow-sm">
            <div className="flex items-baseline justify-between gap-3"><h2 className="text-xl font-bold text-slate-950" id="role-list-title">ロール</h2><span className="text-sm text-slate-600">{state.roles.length}件</span></div>
            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3 font-semibold">コード</th><th className="px-4 py-3 font-semibold">ロール名</th><th className="px-4 py-3 font-semibold">種別</th><th className="px-4 py-3 font-semibold">状態</th><th className="px-4 py-3"><span className="sr-only">詳細</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {state.roles.map((role) => <tr className="hover:bg-slate-50" key={role.id}><td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{role.code}</td><td className="px-4 py-3 font-medium text-slate-950">{role.name}</td><td className="px-4 py-3">{role.isSystem ? <SystemRoleBadge /> : <span className="text-slate-700">カスタム</span>}</td><td className="px-4 py-3"><RoleStatusBadge status={role.status} /></td><td className="px-4 py-3 text-right"><Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href={`/authorization/roles/${encodeURIComponent(role.id)}`}>詳細</Link></td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="permission-catalog-title" className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950" id="permission-catalog-title">権限カタログ</h2>
            <p className="mt-2 text-sm text-slate-700">APIのtyped registryに存在する権限だけを表示します。</p>
            <ul className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200">
              {state.permissions.map((permission) => <li className="p-4" key={permission.id}><p className="font-mono text-xs font-semibold text-slate-900">{permission.code}</p><p className="mt-1 text-sm text-slate-700">{permission.description}</p><p className="mt-2 text-xs text-slate-600">{permission.customRoleAssignable ? "カスタムロールへ割当可能" : "システム管理権限（カスタムロールへ割当不可）"}</p></li>)}
            </ul>
          </section>
          {canManage && <section aria-labelledby="create-role-title" className="rounded-xl bg-white p-5 shadow-sm xl:col-span-2"><h2 className="text-xl font-bold text-slate-950" id="create-role-title">カスタムロールを作成</h2><p className="mt-2 text-sm text-slate-700">コードは作成後に変更できません。SYSTEM_ADMINやLEGACY_AUTHENTICATEDを作成・変更することはできません。</p>{success !== null && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{success}</p>}<form className="mt-5 grid gap-4 md:grid-cols-2" noValidate onSubmit={(event) => void createRole(event)}><label className="block"><span className="text-sm font-medium text-slate-800">ロールコード</span><input aria-describedby={errors.code === undefined ? undefined : "role-code-error"} autoCapitalize="characters" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-950" disabled={isSubmitting} onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))} value={values.code} />{errors.code !== undefined && <span className="mt-1 block text-sm text-red-700" id="role-code-error">{errors.code}</span>}</label><label className="block"><span className="text-sm font-medium text-slate-800">ロール名</span><input aria-describedby={errors.name === undefined ? undefined : "role-name-error"} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={isSubmitting} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} value={values.name} />{errors.name !== undefined && <span className="mt-1 block text-sm text-red-700" id="role-name-error">{errors.name}</span>}</label><label className="block md:col-span-2"><span className="text-sm font-medium text-slate-800">説明（任意）</span><textarea aria-describedby={errors.description === undefined ? undefined : "role-description-error"} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={isSubmitting} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} value={values.description} />{errors.description !== undefined && <span className="mt-1 block text-sm text-red-700" id="role-description-error">{errors.description}</span>}</label>{formError !== null && <p className="md:col-span-2 text-sm text-red-800" role="alert">{formError}</p>}<div className="md:col-span-2"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={isSubmitting} type="submit">{isSubmitting ? "作成中…" : "カスタムロールを作成"}</button></div></form></section>}
        </div>
      )}
    </section>
  );
}

export function AuthorizationRoleDetailPage({ roleId }: Readonly<{ roleId: string }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const canRead = permissions.has("authorization.read");
  const canManage = permissions.has("authorization.manage");
  const [state, setState] = useState<RoleDetailState>({ status: "loading" });
  const [values, setValues] = useState<CustomRoleUpdateValues | null>(null);
  const [errors, setErrors] = useState<AuthorizationFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingPermissionId, setPendingPermissionId] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.all([
      api.request<unknown>(`/authorization/roles/${encodeURIComponent(roleId)}`),
      api.request<unknown>("/authorization/permissions"),
      api.request<unknown>(`/authorization/roles/${encodeURIComponent(roleId)}/permissions`),
    ]).then(([rolePayload, catalogPayload, assignedPayload]) => {
      if (!isAuthorizationRole(rolePayload) || !isAuthorizationPermissionList(catalogPayload) || !isAuthorizationPermissionList(assignedPayload)) throw new ApiError("server");
      if (!active) return;
      setState({ status: "ready", role: rolePayload, catalog: catalogPayload, assignedPermissions: assignedPayload });
      setValues(customRoleUpdateValues(rolePayload));
      setErrors({});
      setFormError(null);
      setActionError(null);
      setReloadRequired(false);
    }).catch((error: unknown) => {
      if (!active || handleAuthorizationError(error, refreshAuthentication) === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") setState({ status: "not_found" });
      else setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canRead, refreshAuthentication, retryKey, roleId]);

  function reload() {
    setSuccess(null);
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  function requireReload(error: unknown) {
    if (!isStaleMutationError(error)) return;
    setReloadRequired(true);
    setActionError("他の管理者による変更の可能性があります。再読み込みしてから続けてください。");
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || values === null || state.role.isSystem || !canManage || isSubmitting || reloadRequired) return;
    const nextErrors = validateCustomRoleUpdate(values);
    setErrors(nextErrors);
    setFormError(null);
    setSuccess(null);
    if (Object.keys(nextErrors).length > 0) return;
    const payload = customRoleUpdatePayload(values, state.role);
    if (Object.keys(payload).length === 0) {
      setFormError("変更内容がありません。");
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await api.request<unknown>(`/authorization/roles/${encodeURIComponent(state.role.id)}`, { method: "PATCH", body: payload });
      if (!isAuthorizationRole(updated) || updated.isSystem) throw new ApiError("server");
      setState((current) => current.status === "ready" ? { ...current, role: updated } : current);
      setValues(customRoleUpdateValues(updated));
      setSuccess("カスタムロールを更新しました。状態変更は次のAPIリクエストから有効です。");
    } catch (error: unknown) {
      const kind = handleAuthorizationError(error, refreshAuthentication);
      if (kind !== "unauthorized" && kind !== "forbidden") setFormError(errorMessage(error));
      requireReload(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changePermission(permission: AuthorizationPermission, action: "grant" | "revoke") {
    if (state.status !== "ready" || state.role.isSystem || !canManage || reloadRequired || pendingPermissionId !== null) return;
    setPendingPermissionId(permission.id);
    setActionError(null);
    setSuccess(null);
    try {
      const path = `/authorization/roles/${encodeURIComponent(state.role.id)}/permissions/${encodeURIComponent(permission.id)}`;
      await api.request<unknown>(path, { method: action === "grant" ? "POST" : "DELETE" });
      setState((current) => {
        if (current.status !== "ready") return current;
        return {
          ...current,
          assignedPermissions: action === "grant"
            ? grantPermissionLocally(current.assignedPermissions, current.catalog, permission.id)
            : revokePermissionLocally(current.assignedPermissions, permission.id),
        };
      });
      setSuccess(action === "grant" ? `「${permission.code}」を割り当てました。` : `「${permission.code}」を解除しました。`);
    } catch (error: unknown) {
      const kind = handleAuthorizationError(error, refreshAuthentication);
      if (kind !== "unauthorized" && kind !== "forbidden") setActionError(errorMessage(error));
      requireReload(error);
    } finally {
      setPendingPermissionId(null);
    }
  }

  if (!canRead) return <ReadAccessRequired />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">ロール詳細を読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950">ロールが見つかりません</h1><Link className="mt-4 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/authorization">認可管理へ戻る</Link></section>;
  if (state.status === "error") return <LoadError message={state.message} retry={reload} />;

  const { role } = state;
  const canEditRole = canManage && !role.isSystem && !reloadRequired;
  const assignedPermissionIds = new Set(state.assignedPermissions.map((permission) => permission.id));
  return (
    <section aria-labelledby="authorization-role-title" className="max-w-6xl">
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/authorization">← 認可管理へ戻る</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-sm text-slate-600">{role.code}</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950" id="authorization-role-title">{role.name}</h1><p className="mt-2 max-w-3xl text-sm text-slate-700">{role.description ?? "説明は登録されていません。"}</p></div><div className="flex flex-wrap gap-2">{role.isSystem && <SystemRoleBadge />}<RoleStatusBadge status={role.status} /></div></div>
      {reloadRequired && <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm text-amber-950">表示中の状態は古い可能性があります。変更操作を停止しています。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reload} type="button">最新状態を再読み込み</button></div>}
      {success !== null && <p className="mt-6 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{success}</p>}
      {actionError !== null && <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">{actionError}</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="role-permissions-title" className="rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950" id="role-permissions-title">ロールの権限</h2>{role.isSystem && <p className="mt-2 text-sm text-slate-700">システムロールの権限はAPIとデータベースで保護されており、この画面からは変更できません。</p>}<ul className="mt-5 divide-y divide-slate-200 rounded-lg border border-slate-200">{state.catalog.map((permission) => { const assigned = assignedPermissionIds.has(permission.id); const mutable = canEditRole && permission.customRoleAssignable; return <li className="flex flex-wrap items-center justify-between gap-3 p-4" key={permission.id}><div><p className="font-mono text-xs font-semibold text-slate-900">{permission.code}</p><p className="mt-1 text-sm text-slate-700">{permission.description}</p><p className="mt-1 text-xs text-slate-600">{permission.customRoleAssignable ? "カスタムロールへ割当可能" : "システム管理権限"}</p></div><div className="flex items-center gap-2">{assigned && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">割当済み</span>}{mutable && <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={pendingPermissionId !== null} onClick={() => void changePermission(permission, assigned ? "revoke" : "grant")} type="button">{pendingPermissionId === permission.id ? "処理中…" : assigned ? "解除" : "割当"}</button>}</div></li>; })}</ul></section>
        <section aria-labelledby="role-summary-title" className="rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950" id="role-summary-title">安全性と状態</h2><dl className="mt-5 space-y-4 text-sm"><div><dt className="font-medium text-slate-600">種別</dt><dd className="mt-1 text-slate-950">{role.isSystem ? "システムロール（保護）" : "カスタムロール"}</dd></div><div><dt className="font-medium text-slate-600">状態</dt><dd className="mt-1 text-slate-950">{roleStatusLabel(role.status)}。無効化されたロールは次のリクエストから権限評価に含まれません。</dd></div><div><dt className="font-medium text-slate-600">最終更新</dt><dd className="mt-1 font-mono text-xs text-slate-950">{role.updatedAt}</dd></div></dl>{role.isSystem ? <p className="mt-6 rounded-lg bg-violet-50 p-4 text-sm text-violet-950">SYSTEM_ADMINとLEGACY_AUTHENTICATEDを含むシステムロールには、無効化・削除・権限変更の操作を表示しません。</p> : canManage ? <form className="mt-6 space-y-4 border-t border-slate-200 pt-6" noValidate onSubmit={(event) => void saveRole(event)}><h3 className="text-lg font-bold text-slate-950">カスタムロールを編集</h3><label className="block"><span className="text-sm font-medium text-slate-800">ロール名</span><input aria-describedby={errors.name === undefined ? undefined : "role-update-name-error"} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={!canEditRole || isSubmitting} onChange={(event) => setValues((current) => current === null ? current : { ...current, name: event.target.value })} value={values?.name ?? ""} />{errors.name !== undefined && <span className="mt-1 block text-sm text-red-700" id="role-update-name-error">{errors.name}</span>}</label><label className="block"><span className="text-sm font-medium text-slate-800">説明</span><textarea aria-describedby={errors.description === undefined ? undefined : "role-update-description-error"} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={!canEditRole || isSubmitting} onChange={(event) => setValues((current) => current === null ? current : { ...current, description: event.target.value })} value={values?.description ?? ""} />{errors.description !== undefined && <span className="mt-1 block text-sm text-red-700" id="role-update-description-error">{errors.description}</span>}</label><label className="block"><span className="text-sm font-medium text-slate-800">状態</span><select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={!canEditRole || isSubmitting} onChange={(event) => setValues((current) => current === null ? current : { ...current, status: event.target.value as RoleStatus })} value={values?.status ?? "ACTIVE"}><option value="ACTIVE">有効</option><option value="DISABLED">無効</option></select></label>{formError !== null && <p className="text-sm text-red-800" role="alert">{formError}</p>}<button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={!canEditRole || isSubmitting} type="submit">{isSubmitting ? "保存中…" : "変更を保存"}</button></form> : <p className="mt-6 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">変更には authorization.manage が必要です。</p>}</section>
      </div>
      <UserRoleAssignments disabled={reloadRequired} onConcurrentChange={() => setReloadRequired(true)} role={role} />
    </section>
  );
}

function UserRoleAssignments({ disabled, onConcurrentChange, role }: Readonly<{ disabled: boolean; onConcurrentChange: () => void; role: AuthorizationRole }>) {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const canReadDirectory = permissions.has("identity.read");
  const canManage = permissions.has("authorization.manage") && !role.isSystem && !disabled;
  const [directory, setDirectory] = useState<DirectoryState>(() => canReadDirectory ? { status: "loading" } : { status: "unavailable" });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userRoles, setUserRoles] = useState<UserRoleState>({ status: "idle" });
  const [pendingAction, setPendingAction] = useState<"grant" | "revoke" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canReadDirectory) {
      return;
    }
    let active = true;
    void api.request<unknown>("/identity/users?status=ACTIVE&deleted=false&limit=100&offset=0").then((payload) => {
      if (!isIdentityUserList(payload)) throw new ApiError("server");
      if (active) setDirectory({ status: "ready", users: payload });
    }).catch((error: unknown) => {
      if (!active || handleAuthorizationError(error, refreshAuthentication) === "unauthorized") return;
      setDirectory({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canReadDirectory, refreshAuthentication]);

  useEffect(() => {
    if (selectedUserId.length === 0) return;
    let active = true;
    void api.request<unknown>(`/authorization/users/${encodeURIComponent(selectedUserId)}/roles`).then((payload) => {
      if (!isAuthorizationRoleList(payload)) throw new ApiError("server");
      if (active) setUserRoles({ status: "ready", roles: payload });
    }).catch((error: unknown) => {
      if (!active || handleAuthorizationError(error, refreshAuthentication) === "unauthorized") return;
      setUserRoles({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, refreshAuthentication, selectedUserId]);

  async function changeUserRole(action: "grant" | "revoke") {
    if (selectedUserId.length === 0 || userRoles.status !== "ready" || !canManage || pendingAction !== null) return;
    setPendingAction(action);
    setMessage(null);
    try {
      await api.request<unknown>(`/authorization/users/${encodeURIComponent(selectedUserId)}/roles/${encodeURIComponent(role.id)}`, { method: action === "grant" ? "POST" : "DELETE" });
      setUserRoles((current) => current.status !== "ready" ? current : {
        status: "ready",
        roles: action === "grant" ? grantRoleLocally(current.roles, role) : revokeRoleLocally(current.roles, role.id),
      });
      setMessage(action === "grant" ? "ユーザーにカスタムロールを割り当てました。" : "ユーザーからカスタムロールを解除しました。");
    } catch (error: unknown) {
      const kind = handleAuthorizationError(error, refreshAuthentication);
      if (kind !== "unauthorized" && kind !== "forbidden") setMessage(errorMessage(error));
      if (isStaleMutationError(error)) onConcurrentChange();
    } finally {
      setPendingAction(null);
    }
  }

  if (!canReadDirectory) return <section className="mt-6 rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950">ユーザーへのロール割当</h2><p className="mt-2 text-sm text-slate-700">ユーザー検索には identity.read が必要です。Identityの編集機能はこの画面には含まれません。</p></section>;
  const assigned = userRoles.status === "ready" && userRoles.roles.some((candidate) => candidate.id === role.id);
  return <section aria-labelledby="user-role-title" className="mt-6 rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950" id="user-role-title">ユーザーへのロール割当</h2><p className="mt-2 text-sm text-slate-700">既存Identity read APIで有効なユーザーだけを検索します。SYSTEM_ADMINを含むシステムロールはここから割り当て・解除できません。</p>{directory.status === "loading" && <p className="mt-5 text-sm text-slate-700" role="status">ユーザーを読み込んでいます…</p>}{directory.status === "error" && <p className="mt-5 text-sm text-red-800" role="alert">{directory.message}</p>}{directory.status === "ready" && <div className="mt-5 max-w-xl"><label className="block"><span className="text-sm font-medium text-slate-800">対象ユーザー</span><select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" onChange={(event) => { const userId = event.target.value; setSelectedUserId(userId); setUserRoles(userId.length === 0 ? { status: "idle" } : { status: "loading" }); setMessage(null); }} value={selectedUserId}><option value="">ユーザーを選択してください</option>{directory.users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label>{directory.users.length === 0 && <p className="mt-3 text-sm text-slate-700">表示できる有効ユーザーはありません。</p>}</div>}{userRoles.status === "loading" && <p className="mt-5 text-sm text-slate-700" role="status">ユーザーのロールを読み込んでいます…</p>}{userRoles.status === "error" && <p className="mt-5 text-sm text-red-800" role="alert">{userRoles.message}</p>}{userRoles.status === "ready" && <div className="mt-5 rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-700">このロールは現在 {assigned ? "割り当て済みです。" : "割り当てられていません。"}</p>{assigned && <ul className="mt-3 flex flex-wrap gap-2">{userRoles.roles.map((assignedRole) => <li className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-800" key={assignedRole.id}>{assignedRole.code}</li>)}</ul>}{canManage && <div className="mt-4"><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={pendingAction !== null || (!assigned && role.status !== "ACTIVE")} onClick={() => void changeUserRole(assigned ? "revoke" : "grant")} type="button">{pendingAction !== null ? "処理中…" : assigned ? "このロールを解除" : role.status === "ACTIVE" ? "このロールを割当" : "無効ロールは割当不可"}</button></div>}</div>}{message !== null && <p className="mt-4 text-sm text-slate-800" role="status">{message}</p>}</section>;
}
