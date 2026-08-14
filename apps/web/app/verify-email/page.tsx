"use client";

import { useEffect, useRef, useState } from "react";
import { createApiClient } from "@/lib/api-client";

type VerificationState = "checking" | "verified" | "invalid";

export default function VerifyEmailPage() {
  const [api] = useState(createApiClient);
  const [state, setState] = useState<VerificationState>("checking");
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (token === null || token.length === 0) {
      queueMicrotask(() => setState("invalid"));
      return;
    }

    void api.request<unknown>("/auth/email/verification/confirm", {
      method: "POST",
      credentials: "omit",
      body: { token },
      csrf: "none",
    })
      .then(() => setState("verified"))
      .catch(() => setState("invalid"));
  }, [api]);

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <section className="mx-auto max-w-lg rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">Lotus BRAIN メールアドレス確認</h1>
        {state === "checking" && <p className="mt-4">確認しています…</p>}
        {state === "verified" && <p className="mt-4">メールアドレスを確認しました。</p>}
        {state === "invalid" && <p className="mt-4">確認リンクは無効または期限切れです。ログイン後に新しい確認メールをリクエストしてください。</p>}
      </section>
    </main>
  );
}
