"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, createApiClient } from "@/lib/api-client";
import { isUserInvitationAcceptanceComplete } from "@/lib/user-invitations";

type AcceptanceState = "ready" | "submitting" | "complete" | "unconfirmed" | "invalid" | "mismatch" | "policy";

export default function AcceptInvitationPage() {
  const [api] = useState(createApiClient);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<AcceptanceState>("ready");
  const hasReadFragment = useRef(false);

  useEffect(() => {
    if (hasReadFragment.current) return;
    hasReadFragment.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const invitationToken = fragment.get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (invitationToken === null || invitationToken.length === 0) {
      queueMicrotask(() => setState("invalid"));
      return;
    }
    queueMicrotask(() => setToken(invitationToken));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (token === null) {
      setState("invalid");
      return;
    }
    const form = new FormData(formElement);
    const password = form.get("password");
    const confirmPassword = form.get("confirmPassword");
    if (typeof password !== "string" || typeof confirmPassword !== "string" || password !== confirmPassword) {
      setState("mismatch");
      return;
    }

    setState("submitting");
    try {
      const response = await api.request<unknown>("/auth/invitations/accept", {
        method: "POST",
        credentials: "omit",
        body: { token, password },
        csrf: "none",
      });
      setToken(null);
      formElement.reset();
      if (!isUserInvitationAcceptanceComplete(response)) {
        setState("unconfirmed");
        return;
      }
      setState("complete");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 422) {
        setState("policy");
      } else {
        setToken(null);
        setState("invalid");
      }
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-lg rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">Lotus BRAIN 招待の受諾</h1>
        {state === "complete" ? (
          <p className="mt-4">アカウントを作成しました。通常のログイン画面からログインしてください。</p>
        ) : state === "unconfirmed" ? (
          <p className="mt-4" role="alert">アカウント作成の結果を確認できませんでした。再試行せず、管理者にお問い合わせください。</p>
        ) : state === "invalid" ? (
          <p className="mt-4">招待リンクは無効または期限切れです。管理者に新しい招待を依頼してください。</p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="block text-sm font-medium">パスワード</span>
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                disabled={state === "submitting" || token === null}
                name="password"
                required
                type="password"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium">パスワード（確認）</span>
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                disabled={state === "submitting" || token === null}
                name="confirmPassword"
                required
                type="password"
              />
            </label>
            {state === "mismatch" && <p className="text-sm text-red-700">パスワードが一致しません。</p>}
            {state === "policy" && <p className="text-sm text-red-700">パスワード要件を満たしていません。</p>}
            <button
              className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              disabled={state === "submitting" || token === null}
              type="submit"
            >
              {state === "submitting" ? "作成中…" : "アカウントを作成"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
