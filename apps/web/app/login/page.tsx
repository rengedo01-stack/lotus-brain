"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { createApiClient } from "@/lib/api-client";
import {
  completeLoginResponse,
  isMfaRequiredLoginResponse,
  SessionActivationAmbiguityError,
} from "@/lib/login-authentication";

type LoginState = "ready" | "password" | "passkey" | "error";

export default function LoginPage() {
  const api = useMemo(() => createApiClient(), []);
  const [state, setState] = useState<LoginState>("ready");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    if (typeof email !== "string" || typeof password !== "string") return;

    setState("password");
    setMessage(null);
    try {
      const payload = await api.request<unknown>("/auth/login", {
        method: "POST",
        body: { email, password },
        csrf: "none",
      });
      if (isMfaRequiredLoginResponse(payload)) setState("passkey");
      await completeLoginResponse(
        api,
        payload,
        async (options) => startAuthentication({ optionsJSON: options }),
      );
      window.location.assign("/");
    } catch (error: unknown) {
      api.clearCsrfToken();
      if (error instanceof SessionActivationAmbiguityError) {
        // Activation may have committed before a malformed or missing response
        // reached the client. Never retain a shell or infer success with GET.
        window.location.replace("/login");
        return;
      }
      setState("error");
      setMessage("ログインを完了できませんでした。メールアドレスとパスワード、またはパスキーを確認して再試行してください。");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-md rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">Lotus BRAINへログイン</h1>
        <p className="mt-2 text-sm text-gray-700">パスキーMFAが有効な場合、パスワードの後にパスキー認証が必要です。</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
          <label className="block">
            <span className="block text-sm font-medium">メールアドレス</span>
            <input autoComplete="username" className="mt-1 w-full rounded border border-gray-300 px-3 py-2" name="email" required type="email" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium">パスワード</span>
            <input autoComplete="current-password" className="mt-1 w-full rounded border border-gray-300 px-3 py-2" name="password" required type="password" />
          </label>
          <button
            className="w-full rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={state === "password" || state === "passkey"}
            type="submit"
          >
            {state === "passkey" ? "パスキーを確認中…" : state === "password" ? "パスワードを確認中…" : "ログイン"}
          </button>
        </form>
        <Link className="mt-5 inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/forgot-password">
          パスワードをお忘れですか？
        </Link>
        {message !== null && <p className="mt-4 text-sm text-red-800" role="alert">{message}</p>}
      </section>
    </main>
  );
}
