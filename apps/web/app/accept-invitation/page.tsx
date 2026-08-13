"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1";

type AcceptanceState = "ready" | "submitting" | "complete" | "invalid" | "mismatch" | "policy";

export default function AcceptInvitationPage() {
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
    if (token === null) {
      setState("invalid");
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    const confirmPassword = form.get("confirmPassword");
    if (typeof password !== "string" || typeof confirmPassword !== "string" || password !== confirmPassword) {
      setState("mismatch");
      return;
    }

    setState("submitting");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/invitations/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({ token, password }),
      });
      if (response.ok) {
        setToken(null);
        event.currentTarget.reset();
        setState("complete");
      } else if (response.status === 422) {
        setState("policy");
      } else {
        setToken(null);
        setState("invalid");
      }
    } catch {
      setState("invalid");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-lg rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">Lotus BRAIN 招待の受諾</h1>
        {state === "complete" ? (
          <p className="mt-4">アカウントを作成しました。通常のログイン画面からログインしてください。</p>
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
