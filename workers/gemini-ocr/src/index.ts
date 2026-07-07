/**
 * Gemini OCR Worker. Verifies a Turnstile token, rate-limits per IP and globally,
 * and forwards an Uma Musume screenshot to Gemini using a server-held key. Returns
 * Gemini's raw candidate text; the client validates and maps it (skill/uma resolution
 * needs client-side game data). Keeps the shared free-tier key off the client.
 */

import type { Env } from './env';
import { corsHeaders, fail, json, resolveAllowedOrigin } from './http';
import { MAX_BODY_BYTES, parseFormData } from './ocr-request';
import { checkRateLimits } from './rate-limit';
import { verifyTurnstile } from './turnstile';
import { callGemini } from './gemini';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestOrigin = request.headers.get('Origin');
    const allowedOrigin = resolveAllowedOrigin(env.ALLOWED_ORIGIN, requestOrigin);
    const cors = corsHeaders(allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return fail('bad_request', 'Method not allowed.', 405, cors);
    }
    // Reject browser requests from disallowed origins (non-browser clients send no
    // Origin header and are gated by Turnstile instead).
    if (requestOrigin && !allowedOrigin) {
      return fail('origin', 'Origin not allowed.', 403, cors);
    }
    if (!env.GEMINI_API_KEY || !env.TURNSTILE_SECRET_KEY) {
      return fail('unconfigured', 'Worker is not configured.', 500, cors);
    }
    if (Number(request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) {
      return fail('too_large', 'Screenshot is too large to process.', 413, cors);
    }

    const parsed = await parseFormData(request);
    if (!parsed.ok) {
      const status = parsed.tooLarge ? 413 : 400;
      return fail(parsed.tooLarge ? 'too_large' : 'bad_request', parsed.error, status, cors);
    }

    const ip = request.headers.get('CF-Connecting-IP');
    const day = new Date().toISOString().slice(0, 10);

    const limited = await checkRateLimits(env, ip, day);
    if (limited === 'rate_limited') {
      return fail('rate_limited', 'Too many requests. Try again in a minute.', 429, cors);
    }
    if (limited === 'quota_exhausted') {
      return fail('quota_exhausted', 'The shared daily quota is used up. Try again later.', 429, cors);
    }

    if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, parsed.value.token, ip))) {
      return fail('turnstile', 'Verification failed.', 403, cors);
    }

    const result = await callGemini(env, parsed.value);
    if (!result.ok) {
      return fail(result.code, result.message, result.code === 'quota_exhausted' ? 429 : 502, cors);
    }

    return json({ ok: true, text: result.text }, 200, cors);
  }
} satisfies ExportedHandler<Env>;
