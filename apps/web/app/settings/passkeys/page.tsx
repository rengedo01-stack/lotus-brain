"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { FormEvent, useEffect, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1";

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

type PageState = "ready" | "loading" | "registering" | "complete" | "error";

export default function PasskeysSettingsPage() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  useEffect(() => {
    void refreshPasskeys();
  }, []);

  async function csrfToken(): Promise<string> {
    const response = await fetch(`${apiBaseUrl}/auth/csrf`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not establish an authenticated session.");
    const payload = await response.json() as { csrfToken?: unknown };
    if (typeof payload.csrfToken !== "string" || payload.csrfToken.length === 0) {
      throw new Error("Could not establish an authenticated session.");
    }
    return payload.csrfToken;
  }

  async function refreshPasskeys() {
    setState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/passkeys`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Passkeys could not be loaded.");
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) throw new Error("Passkeys could not be loaded.");
      setPasskeys(payload as Passkey[]);
      setState("ready");
    } catch {
      setMessage("パスキーを読み込めませんでした。ログイン状態を確認してください。");
      setState("error");
    }
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = form.get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) return;
    setMessage(null);
    setState("registering");
    try {
      const csrf = await csrfToken();
      const optionsResponse = await fetch(`${apiBaseUrl}/auth/passkeys/registration/options`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ currentPassword }),
      });
      if (!optionsResponse.ok) throw new Error("Passkey registration could not be started.");
      const optionsJSON = await optionsResponse.json();
      const response = await startRegistration({ optionsJSON });
      const verificationResponse = await fetch(`${apiBaseUrl}/auth/passkeys/registration/verify`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ response }),
      });
      if (!verificationResponse.ok) throw new Error("Passkey registration could not be verified.");
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
      const csrf = await csrfToken();
      const response = await fetch(`${apiBaseUrl}/auth/passkeys/${encodeURIComponent(passkeyId)}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) throw new Error("Passkey could not be renamed.");
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
      const csrf = await csrfToken();
      const response = await fetch(`${apiBaseUrl}/auth/passkeys/${encodeURIComponent(passkeyId)}/revoke`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ currentPassword }),
      });
      if (!response.ok) throw new Error("Passkey could not be revoked.");
      setRevokeTarget(null);
      await refreshPasskeys();
      setMessage("パスキーを無効化しました。パスワードログインは引き続き利用できます。");
    } catch {
      setMessage("パスキーを無効化できませんでした。");
      setState("error");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">パスキー</h1>
        <p className="mt-2 text-sm text-gray-700">
          パスキーの登録と管理を行えます。ログイン方法はこの画面では変更されません。
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
