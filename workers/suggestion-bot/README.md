# @drekki/suggestion-bot

Cloudflare Worker that receives suggestions from the app, verifies a
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) token, and forwards a
formatted embed to a Discord webhook for manual triage.

```
app modal → POST / → Worker → (CORS + validate + Turnstile verify + optional rate limit) → Discord
```

## Request contract

`POST /` with JSON body:

```jsonc
{
  "category": "bug" | "feature" | "other",
  "message": "string (1–2000 chars)",
  "token": "turnstile-token",
  "metadata": {
    "route": "/skills",
    "version": "0.13.0+abc1234",
    "userAgent": "..."
  }
}
```

Responses: `200 { "ok": true }` on success; `4xx { "ok": false, "error": "..." }` on validation,
Turnstile, or rate-limit failure.

## Setup

```bash
pnpm install
wrangler login
```

Set the app origin(s) in `wrangler.jsonc` → `vars.ALLOWED_ORIGIN`. Multiple origins are
comma-separated, e.g. `https://torena-sim.pages.dev,https://jalbarrang.github.io`. The
Worker echoes back whichever origin matches the request (CORS requires a single concrete origin)
and rejects browser requests from origins not on the list.

### Secrets (never committed)

```bash
wrangler secret put DISCORD_WEBHOOK_URL    # Discord channel webhook URL
wrangler secret put TURNSTILE_SECRET_KEY   # Turnstile secret key (pairs with public site key)
```

For local dev, copy `.dev.vars.example` → `.dev.vars` and fill it in.

### Optional rate limiting

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Add the returned id to `wrangler.jsonc` (`kv_namespaces`) and uncomment the block. Without it the
Worker simply skips rate limiting.

## Develop / deploy

```bash
pnpm run dev       # wrangler dev (local)
pnpm run deploy    # wrangler deploy
```

## App wiring

After deploy, set in the app env:

- `VITE_SUGGESTION_WORKER_URL` — the deployed Worker URL
- `VITE_TURNSTILE_SITE_KEY` — the public Turnstile site key
