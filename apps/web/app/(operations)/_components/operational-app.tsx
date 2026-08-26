"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, type ApiClient, createApiClient, subscribeToApiSessionEvents } from "@/lib/api-client";
import {
  AuthenticationBootstrapCoordinator,
  bootstrapOperationalAuthentication,
  isBfcacheRestore,
  type CurrentUser,
} from "@/lib/operational-authentication";

type OperationalContextValue = {
  api: ApiClient;
  permissions: ReadonlySet<string>;
  refreshAuthentication(): void;
  user: CurrentUser;
};

type BootstrapState =
  | { status: "loading" }
  | { status: "ready"; user: CurrentUser; permissions: ReadonlySet<string> }
  | { status: "error"; message: string };

const OperationalContext = createContext<OperationalContextValue | null>(null);

export function useOperationalApp(): OperationalContextValue {
  const context = useContext(OperationalContext);
  if (context === null) throw new Error("Operational application context is unavailable.");
  return context;
}

export function OperationalApp({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [api] = useState(createApiClient);
  const [bootstrapCoordinator] = useState(() => new AuthenticationBootstrapCoordinator());
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const resetProtectedState = useCallback(() => {
    bootstrapCoordinator.invalidate();
    api.clearCsrfToken();
    setBootstrapState({ status: "loading" });
  }, [api, bootstrapCoordinator]);

  const refreshAuthentication = useCallback(() => {
    resetProtectedState();
    setReloadKey((current) => current + 1);
  }, [resetProtectedState]);

  useEffect(() => subscribeToApiSessionEvents((event) => {
    if (event !== "unauthorized") return;
    resetProtectedState();
    router.replace("/login");
  }), [resetProtectedState, router]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (isBfcacheRestore(event)) refreshAuthentication();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refreshAuthentication]);

  useEffect(() => {
    let active = true;
    const generation = bootstrapCoordinator.begin();
    void bootstrapOperationalAuthentication(api, bootstrapCoordinator, generation).then((authentication) => {
      if (!active || authentication === null) return;
      setBootstrapState({
        status: "ready",
        user: authentication.user,
        permissions: authentication.permissions,
      });
    }).catch((error: unknown) => {
      if (!active || !bootstrapCoordinator.isCurrent(generation) || (error instanceof ApiError && error.kind === "unauthorized")) return;
      setBootstrapState({
        status: "error",
        message: error instanceof ApiError ? error.message : "アプリケーションを開始できませんでした。",
      });
    });
    return () => {
      active = false;
    };
  }, [api, bootstrapCoordinator, reloadKey]);

  async function logout() {
    setLogoutError(null);
    try {
      await api.request<{ status: "ok" }>("/auth/logout", { method: "POST" });
      resetProtectedState();
      router.replace("/login");
    } catch (error: unknown) {
      if (error instanceof ApiError && error.kind === "unauthorized") return;
      setLogoutError(error instanceof ApiError ? error.message : "ログアウトを完了できませんでした。");
    }
  }

  if (bootstrapState.status === "loading") {
    return <SafeLoadingState />;
  }

  if (bootstrapState.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <section aria-labelledby="bootstrap-error-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900" id="bootstrap-error-title">アプリを開始できませんでした</h1>
          <p className="mt-3 text-sm text-slate-700" role="alert">{bootstrapState.message}</p>
          <button
            className="mt-6 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            onClick={refreshAuthentication}
            type="button"
          >
            再試行
          </button>
        </section>
      </main>
    );
  }

  const context: OperationalContextValue = {
    api,
    permissions: bootstrapState.permissions,
    refreshAuthentication,
    user: bootstrapState.user,
  };

  return (
    <OperationalContext.Provider value={context}>
      <div className="min-h-screen bg-slate-100 md:flex">
        <aside className="border-b border-slate-200 bg-slate-950 text-slate-100 md:flex md:min-h-screen md:w-64 md:flex-col md:border-b-0 md:border-r">
          <div className="px-5 py-5">
            <Link className="text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" href="/">
              Lotus BRAIN
            </Link>
            <p className="mt-1 text-xs text-slate-400">業務オペレーション</p>
          </div>
          <Navigation permissions={bootstrapState.permissions} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 md:px-8">
            <div>
              <p className="text-sm font-medium text-slate-900">{bootstrapState.user.displayName}</p>
              <p className="text-xs text-slate-600">{bootstrapState.user.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <Link className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" href="/settings/passkeys">
                設定
              </Link>
              <button
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                onClick={() => void logout()}
                type="button"
              >
                ログアウト
              </button>
            </div>
            {logoutError !== null && <p className="w-full text-sm text-red-800" role="alert">{logoutError}</p>}
          </header>
          <main className="min-w-0 flex-1 p-5 md:p-8">{children}</main>
        </div>
      </div>
    </OperationalContext.Provider>
  );
}

function SafeLoadingState() {
  return (
    <main aria-busy="true" className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <p className="text-sm text-slate-700" role="status">ログイン状態を確認しています…</p>
    </main>
  );
}

function Navigation({ permissions }: Readonly<{ permissions: ReadonlySet<string> }>) {
  const hasPermission = (permission: string) => permissions.has(permission);

  return (
    <nav aria-label="業務ナビゲーション" className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:overflow-visible">
      <NavigationLink href="/" label="ホーム" />
      {hasPermission("master.read") && <NavigationLink href="/master/products" label="マスター" />}
      {hasPermission("purchase.read") && <NavigationLink href="/purchases" label="仕入" />}
      {hasPermission("stocktake.read") && <NavigationLink href="/stocktakes" label="棚卸" />}
      {hasPermission("production.read") && <NavigationLink href="/productions" label="生産" />}
      {hasPermission("authorization.read") && <NavigationLink href="/authorization" label="認可管理" />}
      <NavigationLink href="/settings/passkeys" label="設定" />
    </nav>
  );
}

function NavigationLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Link
      className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      href={href}
    >
      {label}
    </Link>
  );
}
