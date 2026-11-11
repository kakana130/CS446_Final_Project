/**
 * Browser-side API calls. Every failure becomes a stable `code` (mapped to `errors.*` or
 * `errors.api.*` messages) plus optional per-field codes, so forms can show plain Thai next to
 * the right field. Network failures are retried a few times: weak mobile data is expected.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; fields: Record<string, string>; status: number };

const RETRYABLE_STATUS = new Set([502, 503, 504]);

async function request<T>(url: string, init: RequestInit, retries: number): Promise<ApiResult<T>> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }
      return { ok: false, code: 'network', fields: {}, status: 0 };
    }
    // 503 "dormant" is a real answer, not an outage.
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, data: body as T };
    if (RETRYABLE_STATUS.has(res.status) && body.code !== 'dormant' && attempt < retries) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : 'generic',
      fields: (body.fields as Record<string, string> | undefined) ?? {},
      status: res.status,
    };
  }
}

export function postJson<T>(url: string, body: unknown, retries = 2): Promise<ApiResult<T>> {
  return request<T>(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    retries,
  );
}

export function postForm<T>(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  retries = 3,
): Promise<ApiResult<T>> {
  return request<T>(url, { method: 'POST', body: form, headers }, retries);
}

const API_CODES = new Set([
  'turnstile_failed',
  'rate_limited',
  'dormant',
  'consent_outdated',
  'upload_token_invalid',
  'batch_full',
  'image_too_small',
  'image_type',
  'image_unreadable',
  'too_large',
  'network',
  'not_found',
  'signed_out',
  'already_reported',
  'admin_login',
]);

/** Message key (under `errors`) for an API failure code. */
export function apiErrorKey(code: string): string {
  return API_CODES.has(code) ? `api.${code}` : 'api.generic';
}
