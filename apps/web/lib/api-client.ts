export type ApiErrorKind =
  | "configuration"
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "not_found"
  | "conflict"
  | "server"
  | "network";

const CSRF_HEADER_NAME = "x-csrf-token";

const errorMessages: Record<ApiErrorKind, string> = {
  configuration: "アプリケーションの接続設定を確認してください。",
  unauthorized: "ログイン状態を確認できませんでした。",
  forbidden: "この操作を行う権限がありません。",
  validation: "入力内容を確認してください。",
  not_found: "指定された情報は見つかりませんでした。",
  conflict: "情報が更新されています。最新の状態を確認してください。",
  server: "サービスで問題が発生しました。時間をおいて再試行してください。",
  network: "ネットワークに接続できません。接続を確認して再試行してください。",
};

export class ApiError extends Error {
  public readonly kind: ApiErrorKind;
  public readonly status?: number;

  constructor(
    kind: ApiErrorKind,
    status?: number,
  ) {
    super(errorMessages[kind]);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  csrf?: "auto" | "none";
  /**
   * Some contracts intentionally accept one exact success status rather than
   * the broad HTTP 2xx family. Callers opt into this narrowly where the
   * response is an authentication trust boundary.
   */
  expectedStatus?: number;
  headers?: HeadersInit;
};

export type ApiClient = {
  clearCsrfToken(): void;
  request<T>(path: string, options?: ApiRequestOptions): Promise<T>;
};

type ApiSessionEvent = "unauthorized";

const sessionEventListeners = new Set<(event: ApiSessionEvent) => void>();

export function subscribeToApiSessionEvents(listener: (event: ApiSessionEvent) => void): () => void {
  sessionEventListeners.add(listener);
  return () => sessionEventListeners.delete(listener);
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    throw new ApiError("configuration");
  }

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ApiError("configuration");
  }
}

function endpointUrl(path: string): string {
  return `${apiBaseUrl()}/${path.replace(/^\/+/, "")}`;
}

function isSafeMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function errorKindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 400 || status === 422) return "validation";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "server";
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

export function createApiClient(): ApiClient {
  let csrfToken: string | null = null;

  const clearCsrfToken = () => {
    csrfToken = null;
  };

  const notifyError = (error: ApiError) => {
    if (error.kind === "unauthorized") {
      clearCsrfToken();
      sessionEventListeners.forEach((listener) => listener("unauthorized"));
    }
  };

  const request = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
    const {
      body: requestBody,
      csrf,
      expectedStatus,
      headers: requestHeaders,
      ...fetchOptions
    } = options;
    const method = fetchOptions.method?.toUpperCase() ?? "GET";
    const headers = new Headers(requestHeaders);
    let body: BodyInit | undefined;
    if (requestBody !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(requestBody);
    }

    try {
      if (!isSafeMethod(method) && csrf !== "none") {
        if (csrfToken === null) {
          const csrfPayload = await request<{ csrfToken?: unknown }>("/auth/csrf", { method: "GET" });
          if (typeof csrfPayload.csrfToken !== "string" || csrfPayload.csrfToken.length === 0) {
            throw new ApiError("server");
          }
          csrfToken = csrfPayload.csrfToken;
        }
        headers.set(CSRF_HEADER_NAME, csrfToken);
      }

      const response = await fetch(endpointUrl(path), {
        ...fetchOptions,
        body,
        cache: fetchOptions.cache ?? "no-store",
        credentials: fetchOptions.credentials ?? "include",
        headers,
        method,
      });
      if (!response.ok) {
        const error = new ApiError(errorKindForStatus(response.status), response.status);
        notifyError(error);
        throw error;
      }
      if (expectedStatus !== undefined && response.status !== expectedStatus) {
        throw new ApiError("server", response.status);
      }
      const payload = await parseJson(response);
      return payload as T;
    } catch (error: unknown) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("network");
    }
  };

  return { clearCsrfToken, request };
}
