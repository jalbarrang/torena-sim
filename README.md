# Torena Sim

[![PR Checks](https://github.com/jalbarrang/umalator-global/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/jalbarrang/umalator-global/actions/workflows/pr-checks.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Torena Sim is a race and skill simulation toolkit for **Uma Musume: Pretty Derby** Global server.
It helps players, theorycrafters, and tool builders test race behavior with repeatable simulations instead
of relying only on in-game trial runs.

## Project Context

This repository combines:

- A web app for configuring race scenarios and visualizing outputs.
- A simulation engine for speed, acceleration, stamina, and skill activation behavior.
- Data tooling and scripts for extracting, syncing, and validating skill and course data.

The goal is to provide a practical environment for understanding how different builds and race conditions
affect performance.

## What It Is Used For

Use this project when you want to:

- Compare skill loadouts under the same race setup.
- Evaluate skill activation consistency and expected value.
- Inspect velocity and distance trends across many simulation runs.
- Iterate on runner stats, strategy, and conditions before testing in-game.
- Debug or experiment with simulation logic through local scripts.

## Quick Start

### Install and Run

```bash
pnpm install
pnpm run dev
```

Open the local URL printed by Vite to use the simulator UI.

### Sync Game Data

```bash
pnpm run db:fetch        # 1. Download latest master.mdb to ./db
pnpm run extract:all     # 2. Extract course geometry from master.mdb
pnpm run sync:data       # 3. Sync entity catalog (skills, umas, cards) from GameTora
```

Start with `master.mdb` to establish what's live on Global, then sync GameTora to overlay the full catalog (including upcoming content). `sync:data` only re-fetches data that changed since the last sync.

See [docs/data-extraction/data-pipeline.md](docs/data-extraction/data-pipeline.md) for details.

## Deployment

Production deploys run automatically on every push to `main` (rolling releases). GitHub Releases from [semantic-release](https://github.com/semantic-release/semantic-release) are for changelog/tags only and do not trigger deploys.

The canonical app is hosted on **Cloudflare Pages**.

| Target               | Role      | Workflow                                  | URL                          |
| -------------------- | --------- | ----------------------------------------- | ---------------------------- |
| **Cloudflare Pages** | Canonical | `.github/workflows/deploy-cloudflare.yml` | https://torena-sim.pages.dev |

Cloudflare Pages runs the full build (incl. the Rust/wasm engine) and can also be triggered manually via `workflow_dispatch`.

> Legacy `jalbarrang.github.io/umalator-global` (GitHub Pages) and `sundays-shadow.netlify.app` (Netlify) still serve a static **301 redirect** to the canonical domain from their last deployment, so old inbound links keep working. Their deploy workflows have been retired — the redirects are static and need no further builds.

### Versioning

Releases are driven by [Conventional Commits](https://www.conventionalcommits.org/) on `main` (enforced locally via commitlint). [semantic-release](https://github.com/semantic-release/semantic-release) tags the **deployed commit** and opens a GitHub Release — there is no `chore(release)` commit on `main`.

- **`__APP__VERSION__`**: latest `v*` tag semver + current short commit hash (e.g. `0.13.0+6f1340a`)
- **In-app changelog**: `CHANGELOG.md` is regenerated during deploy builds (`pnpm run changelog:generate`); locally run that after `git fetch --tags` to refresh the modal in dev
- **GitHub Releases**: release notes for Discord / announcements

```bash
# Preview the next version and release notes
GITHUB_TOKEN=<pat> pnpm run release:dry-run

# Tag current commit and create GitHub Release
GITHUB_TOKEN=<pat> pnpm run release
```

Use `DATA_UPDATE_PAT` as `GITHUB_TOKEN` for local releases.

### Required Secrets & Variables

| Name                       | Type     | Used by                                                          |
| -------------------------- | -------- | ---------------------------------------------------------------- |
| `DATA_UPDATE_PAT`          | Secret   | `versioning.yml` — PAT for semantic-release (push tags, releases) |
| `CLOUDFLARE_API_TOKEN`     | Secret   | Cloudflare Pages deploy (scope: *Cloudflare Pages → Edit*)                                                |
| `CLOUDFLARE_ACCOUNT_ID`    | Secret   | Cloudflare Pages deploy (also used by the suggestion-bot Worker)                                          |
| `POSTHOG_PROJECT_ID`       | Secret   | PostHog project ID used to upload production source maps                                                  |
| `POSTHOG_CLI_API_KEY`      | Secret   | PostHog personal API key with error tracking write scope and organization read scope                      |
| `POSTHOG_CLI_HOST`         | Variable | Optional source-map API host; leave unset for US Cloud or use `https://eu.posthog.com` for EU Cloud       |
| `VITE_PUBLIC_POSTHOG_KEY`  | Secret   | Build-time analytics key                                                                                  |
| `VITE_PUBLIC_POSTHOG_HOST` | Variable | Analytics host; the Cloudflare deploy hardcodes `/ingest` (same-origin reverse proxy, `functions/ingest/`) to bypass ad blockers |
| `VITE_PUBLIC_POSTHOG_UI_HOST` | Variable | Optional PostHog UI host for the proxied SDK (default `https://us.posthog.com`)                          |
| `VITE_BASE_PATH`           | Variable | GitHub Pages base path                                                                                    |

## Useful Commands

- `pnpm run dev`: start local development server
- `pnpm run build`: build production assets
- `pnpm run preview`: preview built app
- `pnpm run typecheck`: run TypeScript checks
- `pnpm run lint`: run ESLint
- `pnpm run test`: run test suite
- `pnpm run sync:data`: sync entity catalog from GameTora
- `pnpm run db:fetch`: download latest `master.mdb` to `./db`
- `pnpm run extract:all`: extract course geometry from `master.mdb`

## Acknowledgements

This project is inspired by and built on the work of the Uma simulation community.
Special thanks to:

- **alpha123** for the original simulator and UI foundations.
- **Transparent Dino**, **jechtoff2dudes** and **Kachi** for extensive fixes, systems rework, and simulator enhancements made in VFalator.
- **[GameTora](https://gametora.com/)** for game data, including the entity catalog (skills, umas, support cards), event rewards, and skill hint mappings that power this tool.
- **Ayaliz**, who runs **[hakuraku.moe](https://hakuraku.moe/)**, for race-mechanics findings grounded in real recorded race data — the spot-struggle and dueling behavior in this simulator is calibrated against that research.

## Copyright and Fair Use Notice

Uma Musume: Pretty Derby, its characters, names, artwork, game assets, and related trademarks are the property of
**Cygames, Inc.** and their respective rights holders.

This project is an independent, fan-made simulation and analysis tool. It is not affiliated with, endorsed by, or
sponsored by Cygames, Inc.

Any referenced game data, terminology, or limited derivative material is used for commentary, research, education,
and interoperability purposes. This repository is intended to fall under applicable **fair use / fair dealing**
principles and equivalent exceptions under relevant copyright laws.
