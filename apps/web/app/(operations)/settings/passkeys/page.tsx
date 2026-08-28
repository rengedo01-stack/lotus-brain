"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  emailVerificationRequestPath,
  isEmailVerificationRequestAccepted,
} from "@/lib/email-verification";
import {
  addPasskeyFromResponse,
  isCurrentPasskeyListResponse,
  isPasskeyList,
  isPasskeyMutationResponse,
  passkeyPaths,
  passkeyRenamePath,
  passkeyRevokePath,
  replacePasskeyFromResponse,
  type PasskeyView,
} from "@/lib/passkey-management";
import {
  isPasskeyAuthenticationOptions,
  isPasskeyMfaMutationResponse,
  isPasskeyMfaStatus,
  passkeyMfaErrorMessage,
  passkeyMfaOptionsPath,
  passkeyMfaPaths,
  passkeyMfaVerifyPath,
  type PasskeyMfaAction,
  type PasskeyMfaStatus,
} from "@/lib/passkey-mfa";
import { useOperationalApp } from "../../_components/operational-app";

type PageState = "ready" | "loading" | "registering" | "complete" | "error";
type VerificationRequestState = "ready" | "submitting" | "accepted" | "error";

function verificationRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === "forbidden") {
    return "確認メールをリクエストする権限がありません。ログイン状態を確認してください。";
  }
  return "確認メールをリクエストできませんでした。時間をおいて再試行してください。";
}

function passkeyErrorMessage(error: unknown, action: string): string {
  if (error instanceof ApiError) {
    if (error.kind === "conflict") return "パスキーの状態が更新されています。ページを再読み込みしてから再試行してください。";
    if (error.kind === "forbidden") return "この操作は許可されていません。ログイン状態を確認してください。";
    if (error.kind === "not_found") return "対象のパスキーは見つかりませんでした。ページを再読み込みしてください。";
    if (error.kind === "validation") return "現在のパスワードまたはパスキーの入力内容を確認してください。";
  }
  return `パスキーを${action}できませんでした。時間をおいて再試行してください。`;
}

export default function PasskeysSettingsPage() {
  const { api, refreshAuthentication } = useOperationalApp();
  const [passkeys, setPasskeys] = useState<PasskeyView[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [pendingPasskeyId, setPendingPasskeyId] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<PasskeyMfaStatus | null>(null);
  const [mfaOperation, setMfaOperation] = useState<PasskeyMfaAction | null>(null);
  const [verificationRequestError, setVerificationRequestError] = useState<string | null>(null);
  const [verificationRequestState, setVerificationRequestState] = useState<VerificationRequestState>("ready");
  const passkeyListGeneration = useRef(0);
  const mutationPending =
    state === "registering" ||
    pendingPasskeyId !== null ||
    mfaOperation !== null ||
    verificationRequestState === "submitting";

  const loadPasskeys = useCallback(async () => {
    const generation = passkeyListGeneration.current;
    try {
      const payload = await api.request<unknown>(passkeyPaths.list);
      if (!isPasskeyList(payload)) throw new Error("Passkeys could not be loaded.");
      if (!isCurrentPasskeyListResponse(generation, passkeyListGeneration.current)) return;
      setPasskeys(payload);
      setState("ready");
    } catch (error: unknown) {
      if (!isCurrentPasskeyListResponse(generation, passkeyListGeneration.current)) return;
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage("パスキーを読み込めませんでした。ログイン状態を確認してください。");
      setState("error");
    }
  }, [api, setMessage, setPasskeys, setState]);

  const refreshMfaStatus = useCallback(async () => {
    try {
      const payload = await api.request<unknown>(passkeyMfaPaths.status);
      if (!isPasskeyMfaStatus(payload)) throw new Error("MFA status could not be loaded.");
      setMfaStatus(payload);
    } catch {
      setMfaStatus(null);
    }
  }, [api, setMfaStatus]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadPasskeys();
      void refreshMfaStatus();
    });
  }, [loadPasskeys, refreshMfaStatus]);

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationPending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = form.get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setState("registering");
    try {
      const optionsJSON = await api.request<Parameters<typeof startRegistration>[0]["optionsJSON"]>(passkeyPaths.registrationOptions, {
        method: "POST",
        body: { currentPassword },
      });
      const response = await startRegistration({ optionsJSON });
      const verification = await api.request<unknown>(passkeyPaths.registrationVerify, {
        method: "POST",
        body: { response },
      });
      if (!isPasskeyMutationResponse(verification)) throw new Error("Unexpected passkey registration response.");
      passkeyListGeneration.current += 1;
      setPasskeys((current) => addPasskeyFromResponse(current, verification.passkey));
      void refreshMfaStatus();
      formElement.reset();
      setMessage("パスキーを登録しました。パスワードログインは従来どおり利用できます。");
      setState("complete");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage(passkeyErrorMessage(error, "登録"));
      setState("error");
    }
  }

  async function renamePasskey(event: FormEvent<HTMLFormElement>, passkeyId: string) {
    event.preventDefault();
    if (mutationPending) return;
    const displayName = new FormData(event.currentTarget).get("displayName");
    if (typeof displayName !== "string") return;
    setMessage(null);
    setPendingPasskeyId(passkeyId);
    try {
      const response = await api.request<unknown>(passkeyRenamePath(passkeyId), {
        method: "PATCH",
        body: { displayName },
      });
      if (!isPasskeyMutationResponse(response)) throw new Error("Unexpected passkey rename response.");
      passkeyListGeneration.current += 1;
      setPasskeys((current) => replacePasskeyFromResponse(current, response.passkey));
      setMessage("パスキー名を更新しました。");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage(passkeyErrorMessage(error, "名称変更"));
      setState("error");
    } finally {
      setPendingPasskeyId(null);
    }
  }

  async function revokePasskey(event: FormEvent<HTMLFormElement>, passkeyId: string) {
    event.preventDefault();
    if (mutationPending) return;
    const currentPassword = new FormData(event.currentTarget).get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setPendingPasskeyId(passkeyId);
    try {
      const response = await api.request<unknown>(passkeyRevokePath(passkeyId), {
        method: "POST",
        body: { currentPassword },
      });
      if (!isPasskeyMutationResponse(response)) throw new Error("Unexpected passkey revoke response.");
      passkeyListGeneration.current += 1;
      setPasskeys((current) => replacePasskeyFromResponse(current, response.passkey));
      void refreshMfaStatus();
      setRevokeTarget(null);
      setMessage("パスキーを無効化しました。パスワードログインは引き続き利用できます。");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage(passkeyErrorMessage(error, "無効化"));
      setState("error");
    } finally {
      setPendingPasskeyId(null);
    }
  }

  async function changeMfa(event: FormEvent<HTMLFormElement>, action: PasskeyMfaAction) {
    event.preventDefault();
    if (mutationPending) return;
    const currentPassword = new FormData(event.currentTarget).get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setMfaOperation(action);
    try {
      const optionsJSON = await api.request<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(passkeyMfaOptionsPath(action), {
        method: "POST",
        body: { currentPassword },
      });
      if (!isPasskeyAuthenticationOptions(optionsJSON)) throw new Error("Unexpected MFA options response.");
      const assertion = await startAuthentication({ optionsJSON });
      const response = await api.request<unknown>(passkeyMfaVerifyPath(action), {
        method: "POST",
        body: { response: assertion },
      });
      if (!isPasskeyMfaMutationResponse(response)) throw new Error("Unexpected MFA mutation response.");

      // The API has atomically invalidated every session and cleared this
      // browser's session cookie. Rebootstrap immediately so an authenticated
      // shell can never remain visible after a successful MFA policy change.
      refreshAuthentication();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage(passkeyMfaErrorMessage(error));
    } finally {
      setMfaOperation(null);
    }
  }

  async function requestEmailVerification() {
    if (mutationPending) return;
    setVerificationRequestError(null);
    setVerificationRequestState("submitting");
    try {
      const response = await api.request<unknown>(emailVerificationRequestPath, { method: "POST" });
      if (!isEmailVerificationRequestAccepted(response)) throw new Error("Unexpected email verification response.");
      setVerificationRequestState("accepted");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setVerificationRequestError(verificationRequestErrorMessage(error));
      setVerificationRequestState("error");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">パスキー</h1>
        <p className="mt-2 text-sm text-gray-700">
          パスキーの登録と管理、およびパスワード＋パスキーMFAの設定を行えます。
        </p>
        <p className="mt-3 text-sm">
          <Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href="/settings/password">
            パスワードを変更
          </Link>
        </p>

        <form className="mt-6 space-y-3 border-t pt-6" onSubmit={addPasskey}>
          <h2 className="text-lg font-semibold">パスキーを追加</h2>
          <label className="block">
            <span className="block text-sm font-medium">現在のパスワード</span>
            <input
              autoComplete="current-password"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              disabled={mutationPending}
              name="currentPassword"
              required
              type="password"
            />
          </label>
          <button
            className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={mutationPending}
            type="submit"
          >
            {state === "registering" ? "登録中…" : "パスキーを登録"}
          </button>
        </form>

        {message !== null && <p className="mt-4 text-sm text-gray-800" role="status">{message}</p>}

        <section className="mt-8 border-t pt-6">
          <h2 className="text-lg font-semibold">パスキーMFA</h2>
          {mfaStatus === null ? (
            <p className="mt-3 text-sm text-gray-700">MFAの状態を読み込めませんでした。</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-gray-700">状態: {mfaStatus.enabled ? "有効" : "無効"}</p>
              <p className="mt-1 text-sm text-gray-700">有効なパスキー: {mfaStatus.activePasskeyCount} 件</p>
              <p className="mt-1 text-sm text-gray-700">復旧用メール: {mfaStatus.recoveryEmailVerified ? "確認済み" : "未確認"}</p>
              {!mfaStatus.recoveryEmailVerified && (
                <section aria-labelledby="email-verification-title" className="mt-4 rounded border border-gray-200 p-4">
                  <h3 className="text-base font-semibold" id="email-verification-title">メールアドレスを確認</h3>
                  <p className="mt-2 text-sm text-gray-700">
                    パスキーMFAを有効にするには、ログイン中のメールアドレスの確認が必要です。
                  </p>
                  <button
                    className="mt-3 rounded border border-blue-700 px-3 py-2 text-sm font-medium text-blue-700 disabled:cursor-not-allowed disabled:border-gray-400 disabled:text-gray-500"
                    disabled={mutationPending || verificationRequestState === "accepted"}
                    onClick={() => void requestEmailVerification()}
                    type="button"
                  >
                    {verificationRequestState === "submitting" ? "リクエスト中…" : "確認メールをリクエスト"}
                  </button>
                  {verificationRequestState === "accepted" && (
                    <p className="mt-3 text-sm text-gray-800" role="status">
                      確認メールのリクエストを受け付けました。届いたリンクを開いた後、ページを更新して状態を確認してください。
                    </p>
                  )}
                  {verificationRequestState === "error" && (
                    <p className="mt-3 text-sm text-red-800" role="alert">
                      {verificationRequestError ?? "確認メールをリクエストできませんでした。時間をおいて再試行してください。"}
                    </p>
                  )}
                </section>
              )}
              {!mfaStatus.enabled ? (
                <form className="mt-4 space-y-3" onSubmit={(event) => void changeMfa(event, "enable")}>
                  <p className="text-sm text-gray-700">有効化には、確認済みの復旧用メール、1件以上の有効なパスキー、現在のパスワード、パスキー確認が必要です。</p>
                  <label className="block">
                    <span className="block text-sm font-medium">現在のパスワード</span>
                    <input
                      autoComplete="current-password"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                      disabled={mutationPending}
                      name="currentPassword"
                      required
                      type="password"
                    />
                  </label>
                  <button className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:bg-gray-400" disabled={mutationPending} type="submit">
                    {mfaOperation === "enable" ? "確認中…" : "パスキーMFAを有効化"}
                  </button>
                </form>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={(event) => void changeMfa(event, "disable")}>
                  <p className="text-sm text-gray-700">無効化にも、現在のパスワードとパスキー確認が必要です。</p>
                  <label className="block">
                    <span className="block text-sm font-medium">現在のパスワード</span>
                    <input
                      autoComplete="current-password"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                      disabled={mutationPending}
                      name="currentPassword"
                      required
                      type="password"
                    />
                  </label>
                  <button className="rounded bg-red-700 px-4 py-2 font-medium text-white disabled:bg-gray-400" disabled={mutationPending} type="submit">
                    {mfaOperation === "disable" ? "確認中…" : "パスキーMFAを無効化"}
                  </button>
                </form>
              )}
            </>
          )}
        </section>

        <section className="mt-8 border-t pt-6">
          <h2 className="text-lg font-semibold">登録済みパスキー</h2>
          {state === "loading" ? (
            <p className="mt-3 text-sm text-gray-700">読み込み中…</p>
          ) : passkeys.length === 0 ? (
            <p className="mt-3 text-sm text-gray-700">登録済みのパスキーはありません。</p>
          ) : (
            <ul className="mt-4 space-y-5">
              {passkeys.map((passkey) => (
                <li className="rounded border border-gray-200 p-4" key={passkey.id}>
                  <p className="font-medium">{passkey.displayName ?? "名前のないパスキー"}</p>
                  <p className="mt-1 text-xs text-gray-600">登録: {new Date(passkey.createdAt).toLocaleString("ja-JP")}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    状態: {passkey.revokedAt === null ? "有効" : "無効化済み"}
                  </p>
                  <form
                    className="mt-3 flex gap-2"
                    key={`${passkey.id}:${passkey.updatedAt}`}
                    onSubmit={(event) => void renamePasskey(event, passkey.id)}
                  >
                    <input
                      aria-label="パスキー名"
                      className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
                      defaultValue={passkey.displayName ?? ""}
                      disabled={mutationPending}
                      maxLength={100}
                      name="displayName"
                      required
                    />
                    <button className="rounded border border-gray-400 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:text-gray-500" disabled={mutationPending} type="submit">
                      {pendingPasskeyId === passkey.id ? "更新中…" : "名前を変更"}
                    </button>
                  </form>
                  {passkey.revokedAt === null && (revokeTarget === passkey.id ? (
                    <form className="mt-3 flex gap-2" onSubmit={(event) => void revokePasskey(event, passkey.id)}>
                      <input
                        aria-label="現在のパスワード"
                        autoComplete="current-password"
                        className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
                        disabled={mutationPending}
                        name="currentPassword"
                        required
                        type="password"
                      />
                      <button className="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-gray-400" disabled={mutationPending} type="submit">
                        {pendingPasskeyId === passkey.id ? "無効化中…" : "無効化を確定"}
                      </button>
                    </form>
                  ) : (
                    <button className="mt-3 text-sm text-red-700 disabled:cursor-not-allowed disabled:text-gray-500" disabled={mutationPending} onClick={() => setRevokeTarget(passkey.id)} type="button">
                      このパスキーを無効化
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
