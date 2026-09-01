"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  USER_INVITATION_STATUSES,
  insertUserInvitation,
  isUserInvitation,
  isUserInvitationList,
  replaceUserInvitation,
  resendUserInvitation,
  userInvitationListPath,
  userInvitationStatusLabel,
  type UserInvitation,
  type UserInvitationFilters,
  type UserInvitationStatus,
} from "@/lib/user-invitations";
import { useOperationalApp } from "./operational-app";

type InvitationListState =
  | { status: "loading" }
  | { invitations: UserInvitation[]; status: "ready" }
  | { message: string; status: "error" };

type PendingAction = "create" | `cancel:${string}` | `resend:${string}` | null;

const initialFilters: UserInvitationFilters = { status: "" };

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "招待情報を処理できませんでした。時間をおいて再試行してください。";
}

function isStaleMutationError(error: unknown): boolean {
  return error instanceof ApiError && (error.kind === "conflict" || error.kind === "not_found");
}

function dateTimeLabel(value: string | null): string {
  if (value === null) return "記録なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "記録なし";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function InvitationStatusBadge({ status }: Readonly<{ status: UserInvitationStatus }>) {
  const className = status === "PENDING"
    ? "bg-amber-100 text-amber-950"
    : status === "ACCEPTED"
      ? "bg-emerald-100 text-emerald-900"
      : "bg-slate-200 text-slate-800";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{userInvitationStatusLabel(status)}</span>;
}

function ManageAccessRequired() {
  return (
    <section aria-labelledby="invitation-manage-required-title" className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-xl font-bold text-amber-950" id="invitation-manage-required-title">招待を管理できません</h1>
      <p className="mt-3 text-sm text-amber-900">この画面には identity.manage が必要です。最終的なアクセス判定は常にAPIで行われます。</p>
    </section>
  );
}

export function UserInvitationWorkspacePage() {
  const { api, permissions, refreshAuthentication } = useOperationalApp();
  const canManage = permissions.has("identity.manage");
  const [filters, setFilters] = useState<UserInvitationFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<UserInvitationFilters>(initialFilters);
  const [state, setState] = useState<InvitationListState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [cancelConfirmationId, setCancelConfirmationId] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [mutationBlocked, setMutationBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void api.request<unknown>(userInvitationListPath(appliedFilters)).then((payload) => {
      if (!isUserInvitationList(payload)) throw new ApiError("server");
      if (active) setState({ status: "ready", invitations: payload });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      if (error instanceof ApiError && error.kind === "forbidden") refreshAuthentication();
      if (active) setState({ status: "error", message: errorMessage(error) });
    });
    return () => { active = false; };
  }, [api, appliedFilters, canManage, refreshAuthentication, retryKey]);

  function reload() {
    setCancelConfirmationId(null);
    setMessage(null);
    setMutationBlocked(false);
    setReloadRequired(false);
    setState({ status: "loading" });
    setRetryKey((current) => current + 1);
  }

  function handleMutationError(error: unknown) {
    if (error instanceof ApiError && error.kind === "unauthorized") return;
    if (error instanceof ApiError && error.kind === "forbidden") {
      // A 403 changes only the authorization UX; ApiClient emits a session event only for 401.
      refreshAuthentication();
      setMutationBlocked(true);
      setMessage("この変更はAPIにより拒否されました。権限を再確認するまで、以後の変更操作を停止しています。");
      return;
    }
    if (isStaleMutationError(error)) {
      setReloadRequired(true);
      setMessage("他の管理者による変更または現在の招待状態との競合が発生しました。最新状態を再読み込みしてから続けてください。");
      return;
    }
    setMessage(errorMessage(error));
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "loading" });
    setAppliedFilters(filters);
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction !== null || reloadRequired || mutationBlocked || state.status !== "ready") return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = form.get("email");
    if (typeof email !== "string") return;
    setPendingAction("create");
    setMessage(null);
    try {
      const invitation = await api.request<unknown>("/identity/invitations", { method: "POST", body: { email: email.trim() } });
      if (!isUserInvitation(invitation)) throw new ApiError("server");
      // The create response is the authoritative state. No read-after-write request is necessary.
      setState((current) => current.status === "ready"
        ? { status: "ready", invitations: insertUserInvitation(current.invitations, invitation) }
        : current);
      formElement.reset();
      setMessage("招待を作成し、メール送信を受け付けました。招待tokenはこの画面に表示しません。");
    } catch (error: unknown) {
      handleMutationError(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelInvitation(invitation: UserInvitation) {
    if (pendingAction !== null || reloadRequired || mutationBlocked || cancelConfirmationId !== invitation.id || state.status !== "ready") return;
    setPendingAction(`cancel:${invitation.id}`);
    setMessage(null);
    try {
      const cancelled = await api.request<unknown>(`/identity/invitations/${encodeURIComponent(invitation.id)}`, { method: "DELETE" });
      if (!isUserInvitation(cancelled)) throw new ApiError("server");
      // DELETE returns the lifecycle record, so preserve server truth without a follow-up GET.
      setState((current) => current.status === "ready"
        ? { status: "ready", invitations: replaceUserInvitation(current.invitations, cancelled) }
        : current);
      setCancelConfirmationId(null);
      setMessage("招待を取り消しました。未使用の招待情報と保留中の送信はAPIにより無効化されます。");
    } catch (error: unknown) {
      handleMutationError(error);
    } finally {
      setPendingAction(null);
    }
  }

  async function resendInvitation(invitation: UserInvitation) {
    if (pendingAction !== null || reloadRequired || mutationBlocked || state.status !== "ready") return;
    setPendingAction(`resend:${invitation.id}`);
    setMessage(null);
    try {
      await resendUserInvitation(api, invitation.id);
      // Resend has no invitation view response. Its accepted response is success; avoid an unnecessary GET.
      setMessage("招待メールの再送を受け付けました。送達状況や招待tokenはこの画面に表示しません。");
    } catch (error: unknown) {
      handleMutationError(error);
    } finally {
      setPendingAction(null);
    }
  }

  if (!canManage) return <ManageAccessRequired />;

  const mutationsDisabled = pendingAction !== null || reloadRequired || mutationBlocked;
  return (
    <section aria-labelledby="invitation-workspace-title" className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950" id="invitation-workspace-title">招待管理</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">既存のUser Invitation APIでアカウント作成前の招待を管理します。ロール割当、招待token、認証情報、送達内容はこの画面では扱いません。</p>
        </div>
        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-950">identity.manage</span>
      </div>

      {reloadRequired && <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert"><p className="text-sm text-amber-950">表示中の招待状態は古い可能性があります。変更操作を停止しています。</p><button className="mt-3 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100" onClick={reload} type="button">最新状態を再読み込み</button></section>}
      {message !== null && <p className={`mt-6 rounded-lg p-3 text-sm ${reloadRequired || mutationBlocked ? "border border-amber-200 bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-900"}`} role={reloadRequired || mutationBlocked ? "alert" : "status"}>{message}</p>}

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <form className="rounded-xl bg-white p-5 shadow-sm lg:col-span-2" noValidate onSubmit={createInvitation}>
          <h2 className="text-xl font-bold text-slate-950">招待を作成</h2>
          <p className="mt-2 text-sm text-slate-700">招待先のメールアドレスだけを送信します。ユーザーやロールは作成・付与されません。</p>
          <label className="mt-5 block"><span className="text-sm font-medium text-slate-800">メールアドレス</span><input autoComplete="email" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" disabled={mutationsDisabled} name="email" required type="email" /></label>
          <button className="mt-5 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={mutationsDisabled} type="submit">{pendingAction === "create" ? "作成中…" : "招待を作成"}</button>
        </form>

        <form className="rounded-xl bg-white p-5 shadow-sm lg:col-span-3" onSubmit={submitFilters}>
          <h2 className="text-xl font-bold text-slate-950">招待を絞り込む</h2>
          <label className="mt-5 block max-w-sm"><span className="text-sm font-medium text-slate-800">状態</span><select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950" onChange={(event) => setFilters({ status: event.target.value as UserInvitationFilters["status"] })} value={filters.status}><option value="">すべて</option>{USER_INVITATION_STATUSES.map((status) => <option key={status} value={status}>{userInvitationStatusLabel(status)}</option>)}</select></label>
          <button className="mt-5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" type="submit">検索</button>
        </form>
      </div>

      {state.status === "loading" && <p className="mt-8 text-sm text-slate-700" role="status">招待を読み込んでいます…</p>}
      {state.status === "error" && <section className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5" role="alert"><p className="text-sm text-red-900">{state.message}</p><button className="mt-4 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100" onClick={reload} type="button">再試行</button></section>}
      {state.status === "ready" && <section className="mt-8 overflow-hidden rounded-xl bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="text-xl font-bold text-slate-950">招待一覧</h2><p className="mt-1 text-sm text-slate-700">APIの上限に従い最大100件を表示します。PENDINGだけを取消・再送できます。</p></div>{state.invitations.length === 0 ? <p className="p-5 text-sm text-slate-700">条件に一致する招待はありません。</p> : <ul className="divide-y divide-slate-200">{state.invitations.map((invitation) => <li className="px-5 py-4" key={invitation.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="break-all font-medium text-slate-950">{invitation.email}</p><p className="mt-1 font-mono text-xs text-slate-600">{invitation.id}</p><dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-slate-700 sm:grid-cols-3"><div><dt className="font-medium">作成</dt><dd>{dateTimeLabel(invitation.createdAt)}</dd></div><div><dt className="font-medium">受諾</dt><dd>{dateTimeLabel(invitation.acceptedAt)}</dd></div><div><dt className="font-medium">取消</dt><dd>{dateTimeLabel(invitation.cancelledAt)}</dd></div></dl></div><InvitationStatusBadge status={invitation.status} /></div>{invitation.status === "PENDING" && <div className="mt-4 flex flex-wrap gap-3">{cancelConfirmationId === invitation.id ? <><span className="self-center text-sm text-red-900">この招待を取り消しますか？</span><button className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300" disabled={mutationsDisabled} onClick={() => void cancelInvitation(invitation)} type="button">{pendingAction === `cancel:${invitation.id}` ? "取消中…" : "取り消す"}</button><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" disabled={pendingAction !== null} onClick={() => setCancelConfirmationId(null)} type="button">キャンセル</button></> : <><button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400" disabled={mutationsDisabled} onClick={() => void resendInvitation(invitation)} type="button">{pendingAction === `resend:${invitation.id}` ? "再送を受け付け中…" : "再送"}</button><button className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300" disabled={mutationsDisabled} onClick={() => setCancelConfirmationId(invitation.id)} type="button">取消を確認</button></>}</div>}</li>)}</ul>}</section>}
    </section>
  );
}
