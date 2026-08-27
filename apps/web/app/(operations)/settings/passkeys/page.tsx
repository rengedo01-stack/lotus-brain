"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useOperationalApp } from "../../_components/operational-app";

type Passkey = {
  backedUp: boolean | null;
  createdAt: string;
  deviceType: string | null;
  displayName: string | null;
  id: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  transports: string[];
};

type MfaStatus = {
  activePasskeyCount: number;
  enabled: boolean;
  recoveryEmailVerified: boolean;
};

type PageState = "ready" | "loading" | "registering" | "mfa" | "complete" | "error";

export default function PasskeysSettingsPage() {
  const { api } = useOperationalApp();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);

  const loadPasskeys = useCallback(async () => {
    try {
      const payload = await api.request<unknown>("/auth/passkeys");
      if (!Array.isArray(payload)) throw new Error("Passkeys could not be loaded.");
      setPasskeys(payload as Passkey[]);
      setState("ready");
    } catch {
      setMessage("パスキーを読み込めませんでした。ログイン状態を確認してください。");
      setState("error");
    }
  }, [api, setMessage, setPasskeys, setState]);

  async function refreshPasskeys() {
    setState("loading");
    await loadPasskeys();
  }

  const refreshMfaStatus = useCallback(async () => {
    try {
      const payload = await api.request<MfaStatus>("/auth/mfa/passkey");
      if (
        typeof payload.enabled !== "boolean" ||
        typeof payload.activePasskeyCount !== "number" ||
        typeof payload.recoveryEmailVerified !== "boolean"
      ) {
        throw new Error("MFA status could not be loaded.");
      }
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = form.get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setState("registering");
    try {
      const optionsJSON = await api.request<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkeys/registration/options", {
        method: "POST",
        body: { currentPassword },
      });
      const response = await startRegistration({ optionsJSON });
      await api.request<unknown>("/auth/passkeys/registration/verify", {
        method: "POST",
        body: { response },
      });
      formElement.reset();
      await refreshPasskeys();
      setMessage("パスキーを登録しました。パスワードログインは従来どおり利用できます。");
      setState("complete");
    } catch {
      setMessage("パスキーを登録できませんでした。もう一度新しい登録を開始してください。");
      setState("error");
    }
  }

  async function renamePasskey(event: FormEvent<HTMLFormElement>, passkeyId: string) {
    event.preventDefault();
    const displayName = new FormData(event.currentTarget).get("displayName");
    if (typeof displayName !== "string") return;
    setMessage(null);
    try {
      await api.request<unknown>(`/auth/passkeys/${encodeURIComponent(passkeyId)}`, {
        method: "PATCH",
        body: { displayName },
      });
      await refreshPasskeys();
      setMessage("パスキー名を更新しました。");
    } catch {
      setMessage("パスキー名を更新できませんでした。");
      setState("error");
    }
  }

  async function revokePasskey(event: FormEvent<HTMLFormElement>, passkeyId: string) {
    event.preventDefault();
    const currentPassword = new FormData(event.currentTarget).get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    try {
      await api.request<unknown>(`/auth/passkeys/${encodeURIComponent(passkeyId)}/revoke`, {
        method: "POST",
        body: { currentPassword },
      });
      setRevokeTarget(null);
      await refreshPasskeys();
      setMessage("パスキーを無効化しました。パスワードログインは引き続き利用できます。");
    } catch {
      setMessage("パスキーを無効化できませんでした。");
      setState("error");
    }
  }

  async function changeMfa(event: FormEvent<HTMLFormElement>, action: "enable" | "disable") {
    event.preventDefault();
    const currentPassword = new FormData(event.currentTarget).get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setState("mfa");
    try {
      const optionsJSON = await api.request<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(`/auth/mfa/passkey/${action}/options`, {
        method: "POST",
        body: { currentPassword },
      });
      const assertion = await startAuthentication({ optionsJSON });
      await api.request<unknown>(`/auth/mfa/passkey/${action}/verify`, {
        method: "POST",
        body: { response: assertion },
      });
      setState("complete");
      setMessage(action === "enable"
        ? "パスキーMFAを有効にしました。すべてのセッションが終了したため、もう一度ログインしてください。"
        : "パスキーMFAを無効にしました。すべてのセッションが終了したため、もう一度ログインしてください。");
    } catch {
      setState("error");
      setMessage("MFA設定を変更できませんでした。パスワードとパスキーを確認して再試行してください。");
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
              disabled={state === "registering"}
              name="currentPassword"
              required
              type="password"
            />
          </label>
          <button
            className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={state === "registering"}
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
              {!mfaStatus.enabled ? (
                <form className="mt-4 space-y-3" onSubmit={(event) => void changeMfa(event, "enable")}>
                  <p className="text-sm text-gray-700">有効化には、確認済みの復旧用メール、1件以上の有効なパスキー、現在のパスワード、パスキー確認が必要です。</p>
                  <label className="block">
                    <span className="block text-sm font-medium">現在のパスワード</span>
                    <input
                      autoComplete="current-password"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                      disabled={state === "mfa"}
                      name="currentPassword"
                      required
                      type="password"
                    />
                  </label>
                  <button className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:bg-gray-400" disabled={state === "mfa"} type="submit">
                    {state === "mfa" ? "確認中…" : "パスキーMFAを有効化"}
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
                      disabled={state === "mfa"}
                      name="currentPassword"
                      required
                      type="password"
                    />
                  </label>
                  <button className="rounded bg-red-700 px-4 py-2 font-medium text-white disabled:bg-gray-400" disabled={state === "mfa"} type="submit">
                    {state === "mfa" ? "確認中…" : "パスキーMFAを無効化"}
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
                  <form className="mt-3 flex gap-2" onSubmit={(event) => void renamePasskey(event, passkey.id)}>
                    <input
                      aria-label="パスキー名"
                      className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
                      defaultValue={passkey.displayName ?? ""}
                      maxLength={100}
                      name="displayName"
                      required
                    />
                    <button className="rounded border border-gray-400 px-3 py-2 text-sm" type="submit">名前を変更</button>
                  </form>
                  {passkey.revokedAt === null && (revokeTarget === passkey.id ? (
                    <form className="mt-3 flex gap-2" onSubmit={(event) => void revokePasskey(event, passkey.id)}>
                      <input
                        aria-label="現在のパスワード"
                        autoComplete="current-password"
                        className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2"
                        name="currentPassword"
                        required
                        type="password"
                      />
                      <button className="rounded bg-red-700 px-3 py-2 text-sm text-white" type="submit">無効化を確定</button>
                    </form>
                  ) : (
                    <button className="mt-3 text-sm text-red-700" onClick={() => setRevokeTarget(passkey.id)} type="button">
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
