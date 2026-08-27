"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { ApiError } from "@/lib/api-client";
import {
  isPasswordChangeAccepted,
  passwordChangePath,
  passwordChangePayload,
} from "@/lib/password-change";
import { useOperationalApp } from "../../_components/operational-app";

type SubmissionState = "ready" | "submitting";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === "conflict") return "パスワードの状態が更新されています。もう一度ログインしてから再試行してください。";
    if (error.kind === "forbidden") return "この操作を完了できませんでした。もう一度ログインしてから再試行してください。";
    if (error.kind === "validation") return "新しいパスワードの入力内容を確認してください。";
    return "パスワードを変更できませんでした。時間をおいて再試行してください。";
  }
  return "パスワードを変更できませんでした。時間をおいて再試行してください。";
}

export default function PasswordSettingsPage() {
  const { api } = useOperationalApp();
  const [state, setState] = useState<SubmissionState>("ready");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = passwordChangePayload(
      form.get("currentPassword"),
      form.get("newPassword"),
      form.get("confirmation"),
    );
    if (payload === null) {
      setMessage("現在のパスワードと、新しいパスワードの確認入力を確認してください。");
      return;
    }

    setMessage(null);
    setState("submitting");
    try {
      const response = await api.request<unknown>(passwordChangePath, {
        method: "POST",
        body: payload,
      });
      if (!isPasswordChangeAccepted(response)) throw new Error("Unexpected password change response.");

      api.clearCsrfToken();
      formElement.reset();
      window.location.replace("/login");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setMessage(messageFor(error));
      setState("ready");
    }
  }

  return (
    <section aria-labelledby="password-settings-title" className="mx-auto max-w-xl rounded-xl bg-white p-8 shadow">
      <h1 className="text-2xl font-bold" id="password-settings-title">パスワードを変更</h1>
      <p className="mt-2 text-sm text-gray-700">
        現在のパスワードを確認して、新しいパスワードへ変更します。
      </p>
      <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        変更すると、現在のものを含むすべてのログインが終了します。変更後はログイン画面へ移動します。
      </p>

      <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
        <label className="block">
          <span className="block text-sm font-medium text-gray-900">現在のパスワード</span>
          <input
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            disabled={state === "submitting"}
            name="currentPassword"
            required
            type="password"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-900">新しいパスワード</span>
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            disabled={state === "submitting"}
            name="newPassword"
            required
            type="password"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-900">新しいパスワード（確認）</span>
          <input
            autoComplete="new-password"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            disabled={state === "submitting"}
            name="confirmation"
            required
            type="password"
          />
        </label>
        <button
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-400"
          disabled={state === "submitting"}
          type="submit"
        >
          {state === "submitting" ? "変更中…" : "パスワードを変更"}
        </button>
      </form>

      {message !== null && <p className="mt-4 text-sm text-red-800" role="alert">{message}</p>}

      <p className="mt-6 text-sm">
        <Link className="font-medium text-blue-700 underline-offset-2 hover:underline" href="/settings/passkeys">
          パスキーとMFAの設定へ
        </Link>
      </p>
    </section>
  );
}
