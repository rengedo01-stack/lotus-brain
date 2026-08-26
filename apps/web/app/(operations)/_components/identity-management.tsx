"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  allowedIdentityStatusTransitions,
  IDENTITY_USER_STATUSES,
  identityStatusLabel,
  identityUserListPath,
  isIdentityUser,
  isIdentityUserList,
  type IdentityDirectoryFilters,
  type IdentityUser,
  type IdentityUserStatus,
} from "@/lib/identity";
import { useOperationalApp } from "./operational-app";

type IdentityListState =
  | { status: "loading" }
  | { status: "ready"; users: IdentityUser[] }
  | { message: string; status: "error" };

type IdentityDetailState =
  | { status: "loading" }
  | { status: "not_found" }
  | { message: string; status: "error" }
  | { status: "ready"; user: IdentityUser };

type PendingAction = "delete" | IdentityUserStatus | null;

const initialFilters: IdentityDirectoryFilters = { email: "", status: "", deleted: "all" };

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "ユーザー情報を処理できませんでした。時間をおいて再試行してください。";
}

function handleIdentityError(error: unknown, refreshAuthentication: () => void): "unauthorized" | "forbidden" | "other" {
  if (!(error instanceof ApiError)) return "other";
  if (error.kind === "unauthorized") return "unauthorized";
  if (error.kind === "forbidden") {
    // 403 changes UX state only. ApiClient emits session events only for 401.
    refreshAuthentication();
    return "forbidden";
  }
  return "other";
}

function isStaleMutationError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === "conflict" || error.kind === "not_found");
}

function UserStatusBadge({ status }: Readonly<{ status: IdentityUserStatus }>) {
  const className = status === "ACTIVE"
    ? "bg-emerald-100 text-emerald-900"
    : status === "DISABLED"
      ? "bg-slate-200 text-slate-800"
      : "bg-amber-100 text-amber-950";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{identityStatusLabel(status)}</span>;
}

function ReadAccessRequired() {
  return (
    <section aria-labelledby="identity-read-required-title" className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-xl font-bold text-amber-950" id="identity-read-required-title">ユーザー情報を表示できません</h1>
      <p className="mt-3 text-sm text-amber-900">この画面には identity.read が必要です。最終的なアクセス判定は常にAPIで行われます。</p>
    </section>
  );
}

function dateTimeLabel(value: string | null): string {
  if (value === null) return "記録なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "記録なし";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusActionLabel(status: IdentityUserStatus): string {
  if (status === "ACTIVE") return "有効にする";
  if (status === "DISABLED") return "無効にする";
  return "ロックする";
}

export function IdentityWorkspacePage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const canRead = permissions.has("identity.read");
  const canManage = permissions.has("identity.manage");
  const [filters, setFilters] = useState<IdentityDirectoryFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<IdentityDirectoryFilters>(initialFilters);
  const [state, setState] = useState<IdentityListState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void api.request<unknown>(identityUserListPath(appliedFilters)).then((payload) => {
      if (!isIdentityUserList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", users: payload });
    }).catch((error: unknown) => {
      if (!active || handleIdentityError(error, refreshAuthentication) === "unauthorized") return;
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, appliedFilters, canRead, refreshAuthentication, retryKey]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "loading" });
    setAppliedFilters({ ...filters, email: filters.email.trim() });
  }

  function retry() {
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  if (!canRead) return <ReadAccessRequired />;

  return (
    <section aria-labelledby="identity-workspace-title" className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="identity-workspace-title">ユーザー管理</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">既存のIdentity Administration APIが返すユーザー状態を確認します。作成、復元、認証情報やロール割当の操作はこの画面には含めません。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">{canManage && <><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-950">ライフサイクル管理可</span><Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/identity/invitations">招待管理を開く</Link></>}</div>
      </div>

      <form className="mt-8 grid gap-4 rounded-xl bg-white p-5 shadow-sm md:grid-cols-4" noValidate onSubmit={submitFilters}>
        <label className="block md:col-span-2"><span className="text-sm font-medium text-slate-800">メールアドレス（完全一致）</span><input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" onChange={(event) => setFilters((current) => ({ ...current, email: event.target.value }))} type="email" value={filters.email} /></label>
        <label className="block"><span className="text-sm font-medium text-slate-800">状態</span><select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as IdentityDirectoryFilters["status"] }))} value={filters.status}><option value="">すべて</option>{IDENTITY_USER_STATUSES.map((status) => <option key={status} value={status}>{identityStatusLabel(status)}</option>)}</select></label>
        <label className="block"><span className="text-sm font-medium text-slate-800">削除状態</span><select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" onChange={(event) => setFilters((current) => ({ ...current, deleted: event.target.value as IdentityDirectoryFilters["deleted"] }))} value={filters.deleted}><option value="all">すべて</option><option value="not_deleted">削除されていない</option><option value="deleted">削除済み</option></select></label>
        <div className="md:col-span-4"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" type="submit">検索</button></div>
      </form>

      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">ユーザーを読み込んでいます…</p>}
      {state.status === "error" && <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5" role="alert"><p className="text-sm text-red-900">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={retry} type="button">再試行</button></section>}
      {state.status === "ready" && <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="text-xl font-bold text-slate-950">ユーザー一覧</h2><p className="mt-1 text-sm text-slate-700">APIの上限に従い最大100件を表示します。削除済みユーザーもフィルターで確認できます。</p></div>{state.users.length === 0 ? <p className="p-5 text-sm text-slate-700">条件に一致するユーザーはいません。</p> : <ul className="divide-y divide-slate-200">{state.users.map((user) => <li key={user.id}><Link className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700" href={`/identity/users/${encodeURIComponent(user.id)}`}><div><p className="font-medium text-slate-950">{user.email}</p><p className="mt-1 font-mono text-xs text-slate-600">{user.id}</p></div><div className="flex flex-wrap items-center gap-2"><UserStatusBadge status={user.status} />{user.deletedAt !== null && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900">削除済み</span>}</div></Link></li>)}</ul>}</section>}
    </section>
  );
}

export function IdentityUserDetailPage({ userId }: Readonly<{ userId: string }>) {
  const { api, permissions, refreshAuthentication, user: currentUser } = useOperationalApp();
  const canRead = permissions.has("identity.read");
  const canManage = permissions.has("identity.manage");
  const [state, setState] = useState<IdentityDetailState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [mutationBlocked, setMutationBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void api.request<unknown>(`/identity/users/${encodeURIComponent(userId)}`).then((payload) => {
      if (!isIdentityUser(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", user: payload });
    }).catch((error: unknown) => {
      if (!active || handleIdentityError(error, refreshAuthentication) === "unauthorized") return;
      if (error instanceof ApiError && error.kind === "not_found") {
        setState({ status: "not_found" });
        return;
      }
      setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, canRead, refreshAuthentication, retryKey, userId]);

  function reload() {
    setMessage(null);
    setDeleteConfirmation(false);
    setReloadRequired(false);
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  function handleMutationError(error: unknown) {
    const kind = handleIdentityError(error, refreshAuthentication);
    if (kind === "unauthorized") return;
    if (kind === "forbidden") {
      setMutationBlocked(true);
      setMessage("この変更はAPIにより拒否されました。権限または保護対象の状態を再確認するため、以後の変更操作を停止しています。");
      return;
    }
    if (isStaleMutationError(error)) {
      setReloadRequired(true);
      setMessage("他の管理者による変更の可能性があります。最新状態を再読み込みしてから続けてください。");
      return;
    }
    setMessage(errorMessage(error));
  }

  async function changeStatus(nextStatus: IdentityUserStatus) {
    if (state.status !== "ready" || pendingAction !== null || reloadRequired || mutationBlocked) return;
    setPendingAction(nextStatus);
    setMessage(null);
    try {
      const updated = await api.request<unknown>(`/identity/users/${encodeURIComponent(state.user.id)}`, { method: "PATCH", body: { status: nextStatus } });
      if (!isIdentityUser(updated)) throw new ApiError("server");
      // The mutation response is authoritative. Do not turn a committed change into a false UI failure with a follow-up GET.
      setState({ status: "ready", user: updated });
      setMessage(`ユーザーを${identityStatusLabel(updated.status)}に変更しました。対象セッションは次のAPIリクエストで再評価されます。`);
    } catch (error: unknown) {
      handleMutationError(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function softDelete() {
    if (state.status !== "ready" || pendingAction !== null || reloadRequired || mutationBlocked || !deleteConfirmation) return;
    setPendingAction("delete");
    setMessage(null);
    try {
      const updated = await api.request<unknown>(`/identity/users/${encodeURIComponent(state.user.id)}`, { method: "DELETE" });
      if (!isIdentityUser(updated)) throw new ApiError("server");
      // DELETE also returns the authoritative lifecycle record, so no re-fetch is needed.
      setState({ status: "ready", user: updated });
      setDeleteConfirmation(false);
      setMessage("ユーザーを削除済みに変更しました。復元はこのAPI契約には含まれません。対象セッションは次のAPIリクエストで無効になります。");
    } catch (error: unknown) {
      handleMutationError(error);
    } finally {
      setPendingAction(null);
    }
  }

  if (!canRead) return <ReadAccessRequired />;
  if (state.status === "loading") return <p className="text-sm text-slate-700" role="status">ユーザーを読み込んでいます…</p>;
  if (state.status === "not_found") return <section className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950">ユーザーが見つかりません</h1><Link className="mt-4 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/identity">ユーザー管理へ戻る</Link></section>;
  if (state.status === "error") return <section className="rounded-xl border border-red-200 bg-red-50 p-6" role="alert"><p className="text-sm text-red-900">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={reload} type="button">再試行</button></section>;

  const { user } = state;
  const isCurrentUser = user.id === currentUser.id;
  const canChangeLifecycle = canManage && !isCurrentUser && user.deletedAt === null && !reloadRequired && !mutationBlocked;
  const transitions = canChangeLifecycle ? allowedIdentityStatusTransitions(user) : [];

  return (
    <section aria-labelledby="identity-user-title" className="max-w-5xl">
      <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/identity">← ユーザー管理へ戻る</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="break-all text-3xl font-bold tracking-tight text-slate-950" id="identity-user-title">{user.email}</h1><p className="mt-2 font-mono text-xs text-slate-600">{user.id}</p></div><div className="flex flex-wrap gap-2"><UserStatusBadge status={user.status} />{user.deletedAt !== null && <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-900">削除済み</span>}</div></div>

      {reloadRequired && <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm text-amber-950">表示中の状態は古い可能性があります。変更操作を停止しています。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reload} type="button">最新状態を再読み込み</button></div>}
      {message !== null && <p className={`mt-6 rounded-lg p-3 text-sm ${reloadRequired || mutationBlocked ? "border border-amber-200 bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-900"}`} role={reloadRequired || mutationBlocked ? "alert" : "status"}>{message}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-2"><section className="rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950">ユーザー状態</h2><dl className="mt-5 space-y-4 text-sm"><div><dt className="font-medium text-slate-600">現在の状態</dt><dd className="mt-1 text-slate-950">{identityStatusLabel(user.status)}</dd></div><div><dt className="font-medium text-slate-600">削除日時</dt><dd className="mt-1 text-slate-950">{dateTimeLabel(user.deletedAt)}</dd></div><div><dt className="font-medium text-slate-600">最終ログイン</dt><dd className="mt-1 text-slate-950">{dateTimeLabel(user.lastLoginAt)}</dd></div><div><dt className="font-medium text-slate-600">作成日時</dt><dd className="mt-1 text-slate-950">{dateTimeLabel(user.createdAt)}</dd></div><div><dt className="font-medium text-slate-600">最終更新</dt><dd className="mt-1 text-slate-950">{dateTimeLabel(user.updatedAt)}</dd></div></dl></section>
        <section aria-labelledby="identity-lifecycle-title" className="rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950" id="identity-lifecycle-title">ライフサイクル管理</h2>{isCurrentUser ? <p className="mt-3 rounded-lg bg-violet-50 p-4 text-sm text-violet-950">ログイン中のユーザー自身に対する無効化・ロック・削除は、この画面では表示しません。</p> : user.deletedAt !== null ? <p className="mt-3 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">削除済みユーザーは変更できません。復元は既存APIの対象外です。</p> : !canManage ? <p className="mt-3 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">変更には identity.manage が必要です。</p> : mutationBlocked ? <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">APIが保護対象または現在の権限状態として変更を拒否したため、この画面での変更を停止しています。</p> : <><p className="mt-3 text-sm text-slate-700">状態変更はAPIの許可する遷移だけを表示します。SYSTEM_ADMINを含む保護対象の最終判定はAPIとデータベースが行います。</p><div className="mt-5 flex flex-wrap gap-3">{transitions.map((status) => <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={pendingAction !== null || reloadRequired} key={status} onClick={() => void changeStatus(status)} type="button">{pendingAction === status ? "処理中…" : statusActionLabel(status)}</button>)}</div><div className="mt-7 border-t border-slate-200 pt-6"><h3 className="text-base font-bold text-slate-950">ユーザーを削除</h3><p className="mt-2 text-sm text-slate-700">履歴を残すsoft deleteです。ログインは拒否され、既存セッションは次のリクエストで無効になります。</p>{deleteConfirmation ? <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"><p className="text-sm text-red-950">このユーザーを削除済みに変更します。復元操作はこの画面にはありません。</p><div className="mt-3 flex flex-wrap gap-3"><button className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300" disabled={pendingAction !== null || reloadRequired} onClick={() => void softDelete()} type="button">{pendingAction === "delete" ? "削除中…" : "削除する"}</button><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-white" disabled={pendingAction !== null} onClick={() => setDeleteConfirmation(false)} type="button">キャンセル</button></div></div> : <button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={pendingAction !== null || reloadRequired} onClick={() => setDeleteConfirmation(true)} type="button">削除を確認</button>}</div></>}</section></div>
      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold text-slate-950">認可設定</h2><p className="mt-2 text-sm text-slate-700">ユーザーへのロール割当はPR-005F1の認可管理で扱います。この画面ではロールを読み書きしません。</p>{permissions.has("authorization.read") && <Link className="mt-4 inline-flex text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/authorization">認可管理を開く</Link>}</section>
    </section>
  );
}
