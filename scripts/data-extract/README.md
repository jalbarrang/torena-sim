# Data Extraction Scripts

Scripts for syncing game data into the JSON files consumed by the app.

For the end-to-end pipeline and source ownership, see:

- [docs/data-extraction/data-pipeline.md](../../docs/data-extraction/data-pipeline.md)
- [docs/adr/0001-data-source-separation.md](../../docs/adr/0001-data-source-separation.md)

## Primary Pipeline

Start with `master.mdb` to establish what's live on Global, then sync GameTora for the full catalog:

```bash
pnpm run db:fetch          # 1. Download latest master.mdb
pnpm run extract:geometry  # 2. Fill missing courseeventparams geometry
pnpm run extract:all       # 3. Combine master metadata + course geometry
pnpm run sync:data         # 4. Sync entity catalog (skills, umas, cards) from GameTora
```

What that produces:

- `sync:data` writes GameTora snapshots under `src/modules/data/json/gametora/`
- `extract:all` writes `src/modules/data/json/course_data.json`
- course extraction also updates `data-manifest.json` (`masterDb.extractedAt`, and `masterDb.resourceVersion` when provided or resolved)

## Current Source Ownership

| Source                 | Owns                                                                                          | Command                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **GameTora snapshots** | skills, character cards, support cards, support effects, training events, reward dictionaries | `pnpm run sync:data`                                    |
| **master.mdb**         | live course IDs and metadata                                                                  | `pnpm run extract:all` or `pnpm run extract:course-data` |
| **uma-skill-tools**    | parsed client corner, straight, and slope geometry                                            | `pnpm run extract:geometry`                              |

## Prerequisites

- **Node 26+** (scripts run via `tsx`; sqlite access uses `node:sqlite`)
- **master.mdb** — required for `extract:all` / `extract:course-data`
- **Network access** — required for `sync:data`; optional for `fetch:support-events`

## Database Location

Place `master.mdb` in a `db/` directory at the project root (gitignored):

```text
uma-sim/
├── db/
│   └── master.mdb
├── scripts/
└── ...
```

All extract scripts auto-detect this path. You can also pass a custom path:

```bash
pnpm exec tsx scripts/data-extract/extract-course-data.ts /path/to/master.mdb
```

Platform defaults:

- **Windows:** `%APPDATA%\..\LocalLow\Cygames\Umamusume\master\master.mdb`
- **macOS/Linux (Steam):** `~/.local/share/Steam/steamapps/compatdata/[AppID]/pfx/.../master.mdb`

## Scripts

### Primary Commands

| Script                   | Command                       | Role                                                                  |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------- |
| `sync-gametora.ts`       | `pnpm run sync:data`           | Sync GameTora snapshots for the entity catalog                        |
| `extract-geometry.ts`    | `pnpm run extract:geometry`    | Fill missing raw-compatible geometry files from parsed client data    |
| `extract-all.ts`         | `pnpm run extract:all`         | Primary `master.mdb` pipeline; combines metadata with course geometry |
| `extract-course-data.ts` | `pnpm run extract:course-data` | Combine master metadata with `courseeventparams/` geometry             |

### Standalone master.mdb Fallback Tools

These scripts still work, but they are no longer part of the recommended pipeline because entity catalog data now comes from GameTora snapshots.

| Script                     | Command                         | Output                                     |
| -------------------------- | ------------------------------- | ------------------------------------------ |
| `extract-skills.ts`        | `pnpm run extract:skills`        | `src/modules/data/json/skills.json`        |
| `extract-support-cards.ts` | `pnpm run extract:support-cards` | `src/modules/data/json/support-cards.json` |
| `extract-uma-info.ts`      | `pnpm run extract:uma-info`      | `src/modules/data/json/umas.json`          |

### Legacy / Redundant Helper

| Script                    | Command                        | Status                                                                                |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `fetch-support-events.ts` | `pnpm run fetch:support-events` | Redundant for the main pipeline; support card events now come from GameTora snapshots |

`fetch:support-events` is kept for now as a standalone utility, but it is no longer required for normal data syncs.

## Course Geometry Sync

`master.mdb` does not contain corners, straights, or slopes. Those values live in
Unity `courseeventparam` assets. The Global client ships transformed UnityFS
content blocks that stock UnityPy cannot currently decode, while JP and Global
use identical race geometry.

The parsed client geometry is produced by
[alpha123/uma-skill-tools](https://github.com/alpha123/uma-skill-tools) and
**vendored into this repo** at
`scripts/data-extract/vendor/uma-skill-tools-course-data.json`, pinned to a
commit SHA recorded in the sibling `*.meta.json`. Normal extraction is therefore
fully offline.

`extract:geometry` reads the vendored snapshot, selects only courses present in
the local `master.mdb`, and generates any missing `courseeventparams/<id>.json`
files. Each generated file is round-trip validated before it is written.
Longchamp 1000 m and 1400 m (`11201`, `11202`) remain excluded because Cygames
ships only incomplete placeholders for them.

```bash
# Fill only missing courses from the vendored snapshot (offline)
pnpm run extract:geometry

# Rewrite every usable course geometry file from the vendored snapshot (offline)
pnpm run extract:geometry --force

# Maintenance: re-download and re-pin the vendored snapshot (network)
pnpm run extract:geometry --refresh
```

> `--force` overwrites all current courses, not just the missing ones. Because
> the vendored snapshot tracks later JP track revisions, this can shift race
> geometry (and therefore sim results) on existing courses. Review the diff and
> re-run the sim tests before committing a `--force` change.

## Resource Version Tracking

Course extraction updates `data-manifest.json` after a successful run.

```bash
# Use a known resource version
pnpm run extract:all -- --resource-version 10004010

# Resolve the latest version from uma.moe before writing the manifest
pnpm run extract:all -- --resolve-resource-version
```

The same flags also work with `pnpm run extract:course-data`.

## Output Files

### Primary Pipeline Outputs

| File                                     | Source        | Produced by                                            |
| ---------------------------------------- | ------------- | ------------------------------------------------------ |
| `src/modules/data/json/gametora/*.json`  | GameTora      | `pnpm run sync:data`                                    |
| `src/modules/data/json/course_data.json` | master.mdb    | `pnpm run extract:all` / `pnpm run extract:course-data`  |
| `data-manifest.json`                     | sync metadata | `pnpm run sync:data`, then updated by course extraction |

### Standalone Fallback Outputs

| File                                        | Source     | Produced by                     |
| ------------------------------------------- | ---------- | ------------------------------- |
| `src/modules/data/json/skills.json`         | master.mdb | `pnpm run extract:skills`        |
| `src/modules/data/json/support-cards.json`  | master.mdb | `pnpm run extract:support-cards` |
| `src/modules/data/json/umas.json`           | master.mdb | `pnpm run extract:uma-info`      |
| `src/modules/data/json/support-events.json` | GameTora   | `pnpm run fetch:support-events`  |

## Merge vs Replace

Course extraction still supports the existing modes:

| Mode                      | Behavior                                                | Use when        |
| ------------------------- | ------------------------------------------------------- | --------------- |
| **Merge** (default)       | Updates courses found in `master.mdb`, preserves others | Regular updates |
| **Replace** (`--replace`) | Overwrites with only current `master.mdb` courses       | Clean rebuild   |

```bash
pnpm run extract:all
pnpm run extract:all -- --replace
```

## Shared Libraries

- `scripts/master-data/shared.ts` — JSON I/O, key sorting, DB path resolution
- `scripts/master-data/database.ts` — SQLite helpers
- `scripts/master-data/uma-api.ts` — latest resource version lookup via `uma.moe`

## Troubleshooting

- **"Failed to open database"** — check the `master.mdb` path, permissions, and whether the game is locking the file.
- **"Could not read courseeventparams"** — ensure the `courseeventparams/` directory exists with course JSON files.
- **`sync:data` network errors** — retry when connectivity is restored.
- **`fetch:support-events` network errors** — the script falls back to `.cache/gametora/` automatically.
