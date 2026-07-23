# PostHog Reverse Proxy — Bypassing Ad Blockers

**Date:** 2026-07-23. **Goal:** Recover the 10–30% of error/analytics events dropped when ad blockers block requests to `*.i.posthog.com`.

**Status: implemented** (same-origin `/ingest` proxy). Pure transport logic: `src/modules/observability/posthog-proxy.ts` (+ test). Cloudflare Pages Function adapter: `functions/ingest/[[path]].ts`. SDK now uses `api_host: /ingest` (set in the deploy workflow) and `ui_host: https://us.posthog.com` (`VITE_PUBLIC_POSTHOG_UI_HOST`, default in `src/config/index.ts`).

## Why events are blocked

Ad blockers (uBlock Origin, EasyPrivacy, AdGuard) ship static blocklists of known analytics hostnames. `us.i.posthog.com` and `us-assets.i.posthog.com` are on them, so the SDK's requests and lazy-loaded assets are dropped before they leave the browser. A reverse proxy routes those requests through a first-party origin the blocklists have never catalogued. Source: <https://posthog.com/docs/advanced/proxy>.

## What a proxy must do (self-hosted reference)

Per <https://posthog.com/docs/advanced/proxy/proxy-reference>:

- Route `/static/*` and `/array/*` → `us-assets.i.posthog.com` (SDK assets + remote config, with cache-control preserved).
- Route everything else → `us.i.posthog.com`.
- Set the `Host` header to the target PostHog domain, or PostHog returns 401.
- Allow `GET` and `POST`; support up to 64 MB bodies (session recordings).
- Forward `X-Forwarded-For` so geolocation stays accurate; strip cookies.
- SDK sets `api_host` = proxy and **`ui_host: 'https://us.posthog.com'`** (without `ui_host` the toolbar and replay player break).

## Recommended option for this repo — same-origin `/ingest` via Cloudflare Pages

We deploy the app from `torena-sim.pages.dev` (Cloudflare Pages, `pages deploy dist`) with **no custom domain**, and we already run Cloudflare Workers (`workers/*`). That makes the subdomain approaches a poor fit and a same-origin path the best fit:

- The app HTML already loads from `torena-sim.pages.dev`, so `torena-sim.pages.dev/ingest/*` is genuinely first-party — no CORS, no new domain, and not a known analytics pattern. The PostHog docs explicitly recommend a relative `api_host: '/ingest'` to avoid cross-origin issues (proxy-reference § CORS).
- Implement with a Cloudflare **Pages Function** (`functions/ingest/[[path]].ts`) or advanced-mode `_worker.js`, using PostHog's Worker proxy logic (route `/static`+`/array` to the assets host, everything else to the API host, set `Host`, forward `CF-Connecting-IP` as `X-Forwarded-For`, drop cookies). Source (Worker code): <https://posthog.com/docs/advanced/proxy/cloudflare>.
- SDK change in `src/modules/observability/posthog-adapter.ts`: `api_host: '/ingest'` (or `VITE_PUBLIC_POSTHOG_HOST` pointed at it) **and add `ui_host: 'https://us.posthog.com'`** (currently absent).

### Alternatives (rejected for now)

1. **PostHog managed reverse proxy** — free for Cloud users, PostHog handles SSL/routing, but requires a **custom domain you control** (CNAME to `*.proxy-us.posthog.com`, DNS-provider proxy disabled). We have no custom domain, so this is blocked until we own one. <https://posthog.com/docs/advanced/proxy/managed-reverse-proxy>.
2. **Cloudflare Worker on a subdomain** (`e.ourdomain.com`) — the canonical doc option, but needs a custom domain on Cloudflare. `*.workers.dev` / `*.pages.dev` subdomains are themselves pattern-blocked, so a bare worker subdomain defeats the purpose.
3. **DNS + Page Rules** — Cloudflare **Enterprise only**. Not applicable.

## Honest limitations

- **Not 100%.** DNS-level uncloaking (NextDNS, Pi-hole) follows CNAME chains to known analytics hosts. Our same-origin path has no CNAME to PostHog, so uncloaking finds nothing — but path-based heuristics could still catch a small slice. Expect recovery of most, not all, blocked events.
- **Avoid giveaway names.** Do not name the path `/analytics`, `/tracking`, `/telemetry`, `/posthog`, `/ph`. `/ingest` or `/e` is fine.
- **Cost.** Every event, replay chunk, flag poll, and asset fetch counts against the Cloudflare Workers request quota (free tier: 100k req/day, no egress fees).
- **Source-map upload is unaffected.** `POSTHOG_CLI_HOST` runs server-side in CI and is never ad-blocked; leave it as-is.
- **Consent/privacy unchanged.** The existing opt-in gate, `before_send` URL sanitizer, and DNT handling continue to apply — the proxy only changes transport, not what is sent.

## Verify after deploy

1. Deploy via the Cloudflare workflow (`wrangler pages deploy dist` auto-compiles `./functions`).
2. In DevTools → Network, confirm events hit `torena-sim.pages.dev/ingest/*` with `200 OK` and appear in PostHog.
3. Repeat with an ad blocker enabled — `/ingest/*` should not be blocked (first-party, same origin).
4. The GitHub repo variable `VITE_PUBLIC_POSTHOG_HOST` is no longer read (the workflow hardcodes `/ingest`); it can be removed.
