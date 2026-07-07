/** Worker environment bindings (vars + secrets + KV). */
export type Env = {
  /** Comma-separated list of app origins allowed to call this Worker (CORS). */
  ALLOWED_ORIGIN: string;
  /** Gemini model id, e.g. "gemini-2.0-flash". */
  GEMINI_MODEL: string;
  /** Google AI Studio API key (secret). */
  GEMINI_API_KEY: string;
  /** Turnstile secret key (secret). */
  TURNSTILE_SECRET_KEY: string;
  /** KV namespace for rate limiting. Optional so `wrangler dev` works without it. */
  RATE_LIMIT_KV?: KVNamespace;
};

/** Machine-readable failure reasons returned to the client as `{ ok: false, code }`. */
export type ErrorCode =
  | 'bad_request'
  | 'origin'
  | 'turnstile'
  | 'too_large'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'upstream'
  | 'unconfigured';
