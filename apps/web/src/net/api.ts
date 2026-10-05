/** Small JSON helper for the HTTP API (same-origin cookie session). */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** server error code, e.g. "slug_taken" */
  error: string | null;
  /** the whole error body (extra fields such as `left`) */
  errorBody: Record<string, unknown> | null;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    return {
      ok: r.ok,
      status: r.status,
      data: r.ok ? json : null,
      error: r.ok ? null : (json?.error ?? `http_${r.status}`),
      errorBody: r.ok ? null : (json as Record<string, unknown> | null),
    };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network', errorBody: null };
  }
}
