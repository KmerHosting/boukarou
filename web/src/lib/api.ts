import { lang } from './i18n'

export class ApiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

type Listener = (error: ApiError) => void
const listeners = new Set<Listener>()

/** Told about sign-in problems (expired session, password to change) from any request. */
export function onAuthError(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET'
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers: {
        'x-lang': lang.value,
        ...(method === 'GET' ? {} : { 'x-boukarou': '1' }),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(lang.value === 'fr' ? 'Le serveur ne répond pas.' : 'The server is not responding.', 0)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new ApiError(data?.error ?? `Error ${response.status}`, response.status, data?.code ?? '')
    if ((error.status === 401 && !path.startsWith('/api/auth/')) || error.code === 'must_change_password') listeners.forEach((l) => l(error))
    throw error
  }
  return data as T
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body })
export const put = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'DELETE', body })

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
