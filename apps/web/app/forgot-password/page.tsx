"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ApiError, createApiClient } from "@/lib/api-client";
import {
  isPasswordRecoveryRequestAccepted,
  passwordRecoveryRequestPath,
  passwordRecoveryRequestPayload,
} from "@/lib/password-recovery";

type RequestState = "ready" | "submitting" | "accepted" | "error";

const acceptedMessage = "メールアドレスが登録されている場合は、パスワード再設定の案内を送信しました。届かない場合は、しばらく待ってからもう一度お試しください。";

export default function ForgotPasswordPage() {
  const api = useMemo(() => createApiClient(), []);
  const [state, setState] = useState<RequestState>("ready");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const email = new FormData(formElement).get("email");
    if (typeof email !== "string") return;

    const payload = passwordRecoveryRequestPayload(email);
    if (payload === null || state === "submitting") return;

    setState("submitting");
    try {
      const response = await api.request<unknown>(passwordRecoveryRequestPath, {
        method: "POST",
        credentials: "omit",
        body: payload,
        csrf: "none",
      });
      if (!isPasswordRecoveryRequestAccepted(response)) throw new ApiError("server");
      formElement.reset();
      setState("accepted");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-md rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">パスワードを再設定</h1>
        {state === "accepted" ? (
          <>
            <p className="mt-4 text-sm text-gray-800" role="status">{acceptedMessage}</p>
            <Link className="mt-6 inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/login">
              ログイン画面へ戻る
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-700">登録済みのメールアドレスを入力してください。</p>
            <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
              <label className="block">
                <span className="block text-sm font-medium">メールアドレス</span>
                <input
                  autoComplete="email"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                  disabled={state === "submitting"}
                  maxLength={320}
                  name="email"
                  required
                  type="email"
                />
              </label>
              <button
                className="w-full rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
                disabled={state === "submitting"}
                type="submit"
              >
                {state === "submitting" ? "送信中…" : "再設定メールを送信"}
              </button>
            </form>
            {state === "error" && (
              <p className="mt-4 text-sm text-red-800" role="alert">
                リクエストを受け付けられませんでした。時間をおいて再試行してください。
              </p>
            )}
            <Link className="mt-6 inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline" href="/login">
              ログイン画面へ戻る
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
