/** HTTP layer: CORS origin gating and JSON response helpers. */

import type { ErrorCode } from './env';

/** Resolves the request's Origin against the allowlist; returns it when allowed, else null. */
export function resolveAllowedOrigin(allowList: string, requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  const allowed = allowList
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  // CORS requires echoing a single concrete origin, never a list.
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

export function fail(
  code: ErrorCode,
  error: string,
  status: number,
  headers: Record<string, string>
): Response {
  return json({ ok: false, code, error }, status, headers);
}
