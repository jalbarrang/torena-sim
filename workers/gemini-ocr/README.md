# @drekki/gemini-ocr

Cloudflare Worker that reads Uma Musume screenshots with the Gemini API using a
server-held key, so users no longer need to bring their own. Verifies a
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) token,
rate-limits per IP and globally, then returns Gemini's raw candidate text. The app
parses, validates, and maps that text client-side (skill/uma resolution needs
client-side game data).

```
wizard → POST / → Worker → (CORS + validate + rate limit + Turnstile verify) → Gemini → text
```

## Request contract

`POST /` with `multipart/form-data`:

- `image` — the screenshot file part (`image/png`, `image/jpeg`, or `image/webp`; the
  mime type is read from the part). Raw bytes, so no base64 bloat on the wire; the
  Worker base64-encodes server-side for Gemini's `inline_data`.
- `token` — the Turnstile token (text part).

Responses always `{ ok, ... }`:

- `200 { "ok": true, "text": "…" }` — joined Gemini candidate text
- `4xx/5xx { "ok": false, "code": "…", "error": "…" }` where `code` is one of
  `bad_request` (400), `origin` (403), `turnstile` (403), `too_large` (413),
  `rate_limited` (429), `quota_exhausted` (429), `upstream` (502), `unconfigured` (500)

## Setup

```bash
bun install
wrangler login
```

Set the app origin(s) in `wrangler.jsonc` → `vars.ALLOWED_ORIGIN` (comma-separated).
`GEMINI_MODEL` defaults to `gemini-2.0-flash`.

### Secrets (never committed)

```bash
wrangler secret put GEMINI_API_KEY        # Google AI Studio API key (free tier)
wrangler secret put TURNSTILE_SECRET_KEY  # Turnstile secret key (pairs with public site key)
```

For local dev, copy `.dev.vars.example` → `.dev.vars` and fill it in. The Turnstile
always-passes test secret `1x0000000000000000000000000000000AA` is handy locally.

### Rate limiting (KV)

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Paste the returned id into `wrangler.jsonc` (`kv_namespaces`). Limits: per-IP 8/min &
40/day, global 1200/day — sized to stay under Gemini free tier (~15 RPM / ~1500 RPD).
Without the binding the Worker skips rate limiting (fine for `wrangler dev`, which
provisions a local KV automatically).

## Develop / deploy

```bash
bun run dev       # wrangler dev (local, :8787)
bun run deploy    # wrangler deploy
```

## App wiring

After deploy, set in the app env:

- `VITE_OCR_WORKER_URL` — the deployed Worker URL
- `VITE_TURNSTILE_SITE_KEY` — the public Turnstile site key (shared with suggestions)
