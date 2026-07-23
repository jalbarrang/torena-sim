# PostHog Error Observability — Research Report

**Date:** 2026-07-23. **Symptom:** Discord notifications show only minified TypeError messages (`Cannot read properties of undefined (reading 'x')`, `undefined is not an object (evaluating 't[0].x')`, `can't access property 0, match is null`) with no usable stack, file, route, or version context.

**Implementation status:** This enhancement now generates hidden production source maps, uploads and deletes them in CI before deployment, explicitly captures unhandled browser errors and promise rejections, registers app/release metadata after consent, records privacy-safe route breadcrumbs, and strips query strings and fragments from event URL properties. PostHog persistence remains disabled until consent. The SDK adapter, consent policy, route tracking, and React error boundary are contained in the supporting `src/modules/observability/` bounded context. The remaining dashboard-side action is optionally replacing the fixed Discord issue alert with a customizable real-time destination.

## 1. Baseline at the start of the investigation (repository facts)

| Area | Finding | Evidence |
|---|---|---|
| SDK versions | `posthog-js` 1.399.1, `@posthog/react` 1.10.3 (resolved in lockfile) | `package.json`, `node_modules/.pnpm` |
| Init | `posthog.init(key, { api_host, defaults: '2026-01-30', opt_out_capturing_by_default: true, respect_dnt: true })` | `src/main.tsx:29-36` |
| Consent | Capturing off until explicit opt-in via banner; stored decision re-applied on load | `src/main.tsx:38-42`, `src/components/analytics-consent-banner.tsx` |
| Exception autocapture | **Not configured in code.** `capture_exceptions` is unset, so posthog-js falls back to the project's remote-config toggle (`autocaptureExceptions`); when enabled remotely it captures `window.onerror` + unhandled rejections, never `console.error` | vendored source: `node_modules/posthog-js/lib/src/extensions/exception-autocapture/index.js` (`_requiredConfig`: unset ⇒ `_remoteEnabled` decides; console errors default `false`) |
| React ErrorBoundary | `<PostHogErrorBoundary>` wraps the whole app with **no `fallback` and no `additionalProperties`**. On a render error it calls `client.captureException(error)` then renders an **empty `<Fragment>`** (white screen) with only a console warning | `src/main.tsx:61-71`; vendored `@posthog/react/dist/esm/index.js` (`componentDidCatch`, `render`) |
| Source maps | `vite.config.ts` sets no `build.sourcemap` ⇒ Vite default `false`. `dist/assets` contains **zero `.map` files**. Nothing uploads source maps to PostHog. All production stacks are unsymbolicated | `vite.config.ts`; `ls dist/assets \| grep -c .map` → 0 |
| Release/version | Build defines `__APP__VERSION__` (`git describe` semver + short SHA) but it is only used in the suggestion modal; it is **not** registered as a PostHog super property and no PostHog release is created at deploy time | `vite.config.ts` (`define`), `src/components/suggestion-modal.tsx:77` |
| Identity | No `posthog.identify`/`register`/custom `capture` calls anywhere in `src/`. Users are anonymous device IDs; `person_profiles` is the SDK default `identified_only` | `rg` over `src/`; posthog-js `defaultConfig` |
| URL/route context | `defaults: '2026-01-30'` implies `capture_pageview: 'history_change'` (SPA route pageviews) and every event, including `$exception`, carries `$current_url` | posthog-js `defaultsThatVaryByConfig` (`>= '2025-05-24'`) |
| Session replay | Not disabled and not configured in code; whether it records is governed by the PostHog project's remote config. No replay-link plumbing exists in alerts | `src/main.tsx` (no `session_recording`/`disable_session_recording`) |
| CI/deploy | `deploy-cloudflare.yml` builds with `VITE_PUBLIC_POSTHOG_KEY`/`HOST` and deploys `dist` via wrangler. No PostHog CLI, no source-map step, no release step | `.github/workflows/deploy-cloudflare.yml` |
| Discord path | Discord alerts come from PostHog Cloud (error-tracking alerting or a CDP Discord destination) — nothing in this repo configures them. (The repo's own Discord webhook worker is only for the suggestion form: `workers/suggestion-bot`) | `workers/suggestion-bot/README.md` |
| Privacy page | Discloses PostHog usage for "features used and to catch errors", anonymous usage, IP, device info | `src/routes/privacy.tsx:81-86` |

### Why the Discord messages look the way they do

1. The alert title is the issue name = exception type + runtime message. Source maps **cannot** rewrite the message text (`t[0].x` is baked into the browser's error string); they fix the **stack trace shown when you click through** to PostHog.
2. With no source maps uploaded and none publicly served, the PostHog issue page shows only minified frames, so clicking through is also useless today — that is the actual fixable gap.
3. PostHog's built-in error-tracking Discord alert has a **fixed format** (issue created/reopened); per docs the customizable alternative is a real-time CDP destination on `$exception` events, whose Content field can interpolate any `event`/`person` properties (e.g. `$current_url`, `$session_id`, a registered `app_version`).

## 2. Ranked gaps

1. **No source maps uploaded (or served)** — stack traces in PostHog are minified; the click-through from Discord is dead-end. Highest impact, well-documented fix.
2. **No release/version tagging** — cannot tell which deploy introduced an error, and source-map symbolication has no release association. Fix rides along with gap 1 (`release-version` at upload) plus a `posthog.register({ app_version: __APP__VERSION__ })`-style super property for event-level filtering.
3. **ErrorBoundary renders a blank screen** — `PostHogErrorBoundary` without `fallback` returns an empty fragment; users see white screen and there is no route/component context attached (`additionalProperties` unused, though `componentStack` is captured internally).
4. **Exception autocapture only implicitly configured** — behavior depends on a dashboard toggle; `capture_console_errors` is off (fine), but there is no explicit `capture_exceptions` config in code documenting intent, and no `posthog.captureException` in `catch` blocks of worker/async paths (WASM workers, fetch flows), so handled failures are invisible.
5. **Discord alert payload is minimal** — fixed-format issue alert. A CDP real-time destination on `$exception` could include URL, version, and a replay deep-link, at the cost of firing per-event rather than per-issue.
6. **Consent ceiling** — `opt_out_capturing_by_default: true` means errors from non-consenting users are never captured. This is a deliberate privacy stance (privacy page + banner) and should stay; just be aware coverage is a subset of traffic.

## 3. Bounded implementation

Scope: CI + config + small `src/main.tsx` additions. No product-feature changes. Items 1–3 and 5 are implemented; item 4's error context is implemented while its user-facing fallback remains a separate UX improvement; item 6 remains an optional PostHog dashboard change.

1. **Enable source-map generation:** `build: { sourcemap: 'hidden' }` in `vite.config.ts` (`hidden` avoids advertising maps via `sourceMappingURL`; PostHog matching uses injected `chunkId` comments, not that comment).
2. **Inject + upload maps in the deploy workflow**, between `pnpm run build` and the wrangler deploy step, using the official action:
   ```yaml
   - uses: PostHog/upload-source-maps@v2
     with:
       directory: dist
       project-id: ${{ secrets.POSTHOG_PROJECT_ID }}
       api-key: ${{ secrets.POSTHOG_CLI_API_KEY }}
       release-version: ${{ github.sha }}   # or the v-tag from git describe
       delete-after-upload: true           # keep maps out of the public deploy
   ```
   This injects `//# chunkId=...` into the served JS (must happen **before** deploy — served assets must be the injected ones) and auto-creates a PostHog **release** (name defaults to repo, version to commit SHA). The action defaults to US Cloud; set `POSTHOG_CLI_HOST=https://eu.posthog.com` for an EU Cloud project. Prefer this over `@posthog/rollup-plugin` because Vite 8 here is Rolldown-based (see risks).
3. **Tag events with the app version:** register `__APP__VERSION__` as a super property after `posthog.init` (e.g. `posthog.register({ app_version: __APP__VERSION__ })`) so `$exception` events and alert templates can reference it.
4. **Give `PostHogErrorBoundary` a `fallback`** (simple "something broke — reload" card) and pass `additionalProperties` (e.g. current route, app version) so boundary-caught errors carry context and users stop getting a white screen.
5. **Make autocapture explicit:** set `capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: false }` in the init config so behavior is code-reviewed, not dashboard-implicit.
6. **(Optional, dashboard-side)** Replace/augment the fixed Discord issue alert with a CDP real-time Discord destination filtered on `$exception`, with Content interpolating `$exception_types`/message, `$current_url`, `app_version`, and a replay link built from `$session_id`. Also connect the GitHub integration so symbolicated frames get "View commit" source links.

Verification: after one deploy, check symbol sets at `https://app.posthog.com/error_tracking/configuration#selectedSetting=error-tracking-symbol-sets`, confirm served JS ends with `//# chunkId=...`, then confirm a new issue's stack trace shows original TS source.

## 4. Official sources

- Source map overview (need upload if not publicly hosted): https://posthog.com/docs/error-tracking/upload-source-maps
- Vite guide (`@posthog/rollup-plugin`, env vars, verification): https://posthog.com/docs/error-tracking/upload-source-maps/vite
- CLI guide (inject → upload → must serve injected assets): https://posthog.com/docs/error-tracking/upload-source-maps/cli
- GitHub Actions guide (`PostHog/upload-source-maps@v2`, release-name/version inputs): https://posthog.com/docs/error-tracking/upload-source-maps/github-actions
- Stack traces (symbol sets, "publicly accessible or uploaded", source linking): https://posthog.com/docs/error-tracking/stack-traces
- Releases (auto-created by CLI upload, git metadata, commit linking): https://posthog.com/docs/error-tracking/releases
- Capture exceptions (`capture_exceptions` options table, `captureException(error, props)`, exception steps, exception properties incl. `$exception_list`): https://posthog.com/docs/error-tracking/capture
- Alerts (fixed Discord/Slack issue alerts; real-time CDP destinations on `$exception`; trend alerts): https://posthog.com/docs/error-tracking/alerts
- Discord CDP destination (Content field interpolates event/person properties): https://posthog.com/docs/cdp/destinations/discord
- React installation (PostHogErrorBoundary usage): https://posthog.com/docs/error-tracking/installation/react
- SDK source of truth for defaults/autocapture consulted from the vendored packages: `posthog-js@1.399.1` (`lib/src/posthog-core.js`, `lib/src/extensions/exception-autocapture/index.js`) and `@posthog/react@1.10.3` (`dist/esm/index.js`) — these mirror https://github.com/PostHog/posthog-js.

## 5. Open risks

- **Rolldown-Vite vs `@posthog/rollup-plugin`:** this repo is on Vite 8 (Rolldown bundler, uses `@rolldown/plugin-babel`). The PostHog Rollup plugin targets classic Rollup; compatibility is unverified. The CI-side GitHub action/CLI path is bundler-agnostic and avoids this entirely — recommended.
- **`sourcemap: 'hidden'` + CLI pairing:** `posthog-cli` pairs `.js` with adjacent `.map` files; expected to work without the `sourceMappingURL` comment, but verify the chunkId comment appears after inject on the first run.
- **Deploy ordering is load-bearing:** if wrangler ever deploys assets built before injection (cache, retry), symbolication silently breaks. Keep inject+upload in the same job, immediately after build.
- **Message text stays minified:** alert titles will still say `t[0].x` for old issues; only new events on symbolicated releases get readable click-through stacks. Grouping/fingerprints of existing issues won't retroactively improve.
- **Consent coverage:** with opt-in-only capture and `respect_dnt`, error telemetry covers only consenting users; some crash classes will remain invisible. Changing this has privacy-page and banner implications — out of scope here.
- **Cost/noise of per-event Discord destination:** a real-time `$exception` destination fires per event, not per issue; without filters it can flood the channel during an error spike. PostHog's spike alerts and client-side rate limiter (10-token bucket per exception type) mitigate but don't eliminate this.
- **Secrets:** the plan adds `POSTHOG_PROJECT_ID` and a personal API key (`error tracking: write`, `organization: read`) to GitHub secrets — a new credential surface to rotate/manage.
