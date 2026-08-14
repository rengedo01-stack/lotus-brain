"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, type ApiClient, createApiClient, subscribeToApiSessionEvents } from "@/lib/api-client";

type CurrentUser = {
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt: string | null;
  status: string;
  updatedAt: string;
};

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

function isCurrentUser(value: unknown): value is CurrentUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.displayName === "string" &&
    typeof user.status === "string" &&
    (typeof user.lastLoginAt === "string" || user.lastLoginAt === null) &&
    typeof user.createdAt === "string" &&
    typeof user.updatedAt === "string"
  );
}

function isMeResponse(value: unknown): value is { user: CurrentUser } {
  return typeof value === "object" && value !== null && isCurrentUser((value as { user?: unknown }).user);
}

function isPermissionsResponse(value: unknown): value is { permissions: string[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { permissions?: unknown }).permissions) &&
    (value as { permissions: unknown[] }).permissions.every((permission) => typeof permission === "string")
  );
}

export function useOperationalApp(): OperationalContextValue {
  const context = useContext(OperationalContext);
  if (context === null) throw new Error("Operational application context is unavailable.");
  return context;
}

export function OperationalApp({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [api] = useState(createApiClient);
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const refreshAuthentication = useCallback(() => {
    setBootstrapState({ status: "loading" });
    setReloadKey((current) => current + 1);
  }, [setBootstrapState, setReloadKey]);

  useEffect(() => subscribeToApiSessionEvents((event) => {
    if (event !== "unauthorized") return;
    api.clearCsrfToken();
    setBootstrapState({ status: "loading" });
    router.replace("/login");
  }), [api, router]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.request<unknown>("/auth/me"),
      api.request<unknown>("/auth/me/permissions"),
    ]).then(([meResponse, permissionsResponse]) => {
      if (!isMeResponse(meResponse) || !isPermissionsResponse(permissionsResponse)) {
        throw new ApiError("server");
      }
      if (!active) return;
      setBootstrapState({
        status: "ready",
        user: meResponse.user,
        permissions: new Set(permissionsResponse.permissions),
      });
    }).catch((error: unknown) => {
      if (!active || (error instanceof ApiError && error.kind === "unauthorized")) return;
      setBootstrapState({
        status: "error",
        message: error instanceof ApiError ? error.message : "アプリケーションを開始できませんでした。",
      });
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  async function logout() {
    setLogoutError(null);
    try {
      await api.request<{ status: "ok" }>("/auth/logout", { method: "POST" });
      api.clearCsrfToken();
      setBootstrapState({ status: "loading" });
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
  const plannedItems = [
    { label: "仕入（準備中）", permission: "purchase.read" },
    { label: "棚卸（準備中）", permission: "stocktake.read" },
    { label: "生産（準備中）", permission: "production.post" },
  ];

  return (
    <nav aria-label="業務ナビゲーション" className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:overflow-visible">
      <NavigationLink href="/" label="ホーム" />
      {hasPermission("master.read") && <NavigationLink href="/master/products" label="マスター" />}
      {plannedItems.filter((item) => hasPermission(item.permission)).map((item) => (
        <span className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-slate-400" key={item.permission}>{item.label}</span>
      ))}
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
