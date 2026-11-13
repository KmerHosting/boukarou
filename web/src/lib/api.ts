import { getLang } from "./i18n";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = (e: ApiError) => void;
const authListeners = new Set<Listener>();
export const onAuthError = (fn: Listener) => {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        "x-lang": getLang(),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-boukarou": "1" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.error || `Request failed (${res.status})`, data.code || "error");
    if (res.status === 401 || err.code === "must_change_password") authListeners.forEach((fn) => fn(err));
    throw err;
  }
  return data as T;
}

export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });
export const del = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "DELETE", body });
export const put = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "PUT", body });
export const patch = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: "PATCH", body });
