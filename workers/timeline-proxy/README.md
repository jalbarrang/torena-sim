# @drekki/timeline-proxy

Cloudflare Worker that proxies uma.moe gacha/banner data. uma.moe serves this data as
static, browser-proof-gated **resources** (not via its documented `/api/*` routes), so this
Worker holds the upstream API key server-side and exposes a small read-only surface.

```
browser/script → GET /timeline → Worker → uma.moe /resources/* → JSON
```

## Routes

| Route | Upstream artifact | Contents |
|-------|-------------------|----------|
| `GET /timeline` | `banner_timeline.json` | Full timeline: banners + events, anniversaries |
| `GET /banners/character` | `character_banners.json` | Character gacha banners |
| `GET /banners/support` | `supports_banners.json` | Support card banners |
| `GET /banners/paid` | `paid_gacha_banners.json` | Paid / step-up banners |
| `GET /` or `/health` | — | `{ ok: true, routes: [...] }` |

All data routes return the upstream JSON (gunzipped) with `Cache-Control: max-age=300`.

## Access gate

A request is allowed when **either** is true:

1. **Origin allowlist** — request `Origin` is in `vars.ALLOWED_ORIGIN` (browser callers).
2. **Local key** — `X-Proxy-Key: <key>` header or `?key=<key>` matches `PROXY_API_KEY`
   (scripts / local dev / non-browser callers that send no `Origin`).

Otherwise the Worker returns `403`.

## Setup

```bash
pnpm install
wrangler login
```

Set allowed origins in `wrangler.jsonc` → `vars.ALLOWED_ORIGIN` (comma-separated).

### Secrets (never committed)

```bash
wrangler secret put UMA_MOE_API_KEY   # upstream uma.moe API key (X-API-Key)
wrangler secret put PROXY_API_KEY     # optional: shared key for non-browser callers
```

For local dev, copy `.dev.vars.example` → `.dev.vars` and fill it in.

## Develop / deploy

```bash
pnpm run dev       # wrangler dev (local)
pnpm run deploy    # wrangler deploy
```

## App wiring

After deploy, set in the app env:

- `VITE_TIMELINE_WORKER_URL` — the deployed Worker URL

Browser requests from an allowed origin need no key. Non-browser callers pass `X-Proxy-Key`.
