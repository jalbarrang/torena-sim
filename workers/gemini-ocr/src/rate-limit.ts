/** Quota domain: per-IP and global rate limiting backed by KV. */

import type { Env, ErrorCode } from './env';

// Per-IP burst: a 5-screenshot import = 5 requests, so this allows one full import
// per minute per user with headroom while staying under Gemini's ~15 RPM.
const IP_MINUTE_MAX = 8;
const IP_MINUTE_WINDOW = 60;
// Per-IP daily: ~8 full imports/day per user.
const IP_DAY_MAX = 40;
const DAY_WINDOW = 86_400;
// Global daily budget: headroom under Gemini free tier (~1500 RPD for flash).
const GLOBAL_DAY_MAX = 1200;

/** Increments a KV counter under a TTL window; returns false when the max is exceeded. */
async function incrementWithinLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  ttlSeconds: number
): Promise<boolean> {
  const current = Number((await kv.get(key)) ?? '0');
  if (current >= max) return false;
  await kv.put(key, String(current + 1), { expirationTtl: ttlSeconds });
  return true;
}

/** Returns an error code when a rate limit is hit, or null when the request may proceed. */
export async function checkRateLimits(
  env: Env,
  ip: string | null,
  day: string
): Promise<ErrorCode | null> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return null;

  if (ip) {
    const okMinute = await incrementWithinLimit(kv, `rl:min:${ip}`, IP_MINUTE_MAX, IP_MINUTE_WINDOW);
    const okDay =
      okMinute && (await incrementWithinLimit(kv, `rl:day:${ip}`, IP_DAY_MAX, DAY_WINDOW));
    if (!okMinute || !okDay) return 'rate_limited';
  }

  const okGlobal = await incrementWithinLimit(kv, `rl:global:${day}`, GLOBAL_DAY_MAX, DAY_WINDOW);
  return okGlobal ? null : 'quota_exhausted';
}
