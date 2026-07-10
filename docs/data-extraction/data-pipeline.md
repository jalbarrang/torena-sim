# Data Pipeline

How game data gets into the project, and which source owns which data.

See also:

- [ADR-0001: Data Source Separation](../adr/0001-data-source-separation.md)
- [scripts/data-extract/README.md](../../scripts/data-extract/README.md)

## Overview

The project uses a two-layer pipeline per entity:

| Layer                   | Source                | Role                                                                    |
| ----------------------- | --------------------- | ----------------------------------------------------------------------- |
| **Global live cutover** | `master.mdb` extracts | What ships in the Global client today — drives `isReleased`             |
| **Full catalog**        | GameTora snapshots    | All entities including upcoming — conditions, `loc.en`, display catalog |

| Source                 | Owns                                                                                       | Access path                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **master.mdb**         | Course geometry; Global cutover JSON (`skills.json`, `umas.json`, `support-cards.json`)    | `pnpm run db:fetch` then `pnpm run extract:all` |
| **GameTora snapshots** | Full entity catalog: skills, character cards, support cards, training events, dictionaries | `pnpm run sync:data`                           |

**Operator rule:** _upcoming_ = in GameTora but not in the master extract; _released on Global_ = present in the master extract.

## Pipeline Commands

Refresh Global cutover first, then overlay the full catalog:

```bash
pnpm run db:fetch        # 1. Download latest master.mdb (Global ground truth)
pnpm run extract:all     # 2. Extract courses + Global cutover artifacts from master.mdb
pnpm run sync:data       # 3. Sync full entity catalog from GameTora
```

`extract:all` runs course extraction plus `extract:skills`, `extract:uma-info`, and `extract:support-cards`.

If you know the `master.mdb` resource version, or want to resolve it from `uma.moe`, pass one of these when extracting courses:

```bash
pnpm run extract:all -- --resource-version 10004010
pnpm run extract:all -- --resolve-resource-version
```

Individual cutover extracts (also invoked by `extract:all`):

```bash
pnpm run extract:skills
pnpm run extract:uma-info
pnpm run extract:support-cards
```

## Source: GameTora Snapshots

GameTora provides the **full catalog** (released + upcoming).

### What `sync:data` writes

`pnpm run sync:data` snapshots these manifest keys into `src/modules/data/json/gametora/`:

| Manifest key             | Output file                   |
| ------------------------ | ----------------------------- |
| `skills`                 | `skills.json`                 |
| `character-cards`        | `character-cards.json`        |
| `support-cards`          | `support-cards.json`          |
| `support_effects`        | `support-effects.json`        |
| `training_events/ssr`    | `training-events-ssr.json`    |
| `training_events/sr`     | `training-events-sr.json`     |
| `training_events/shared` | `training-events-shared.json` |
| `training_events/friend` | `training-events-friend.json` |
| `training_events/group`  | `training-events-group.json`  |
| `dict/evrew`             | `evrew.json`                  |
| `dict/te_names_en`       | `te-names-en.json`            |
| `dict/te_names_ja`       | `te-names-ja.json`            |

### Why GameTora overlays the catalog

GameTora gives us:

- the complete catalog in one place (including upcoming)
- server-specific overrides such as `loc.en`
- support card event skill lists
- provenance dates such as `release_en` (scheduling metadata, not the Global cutover boundary)

## Source: master.mdb

`master.mdb` provides simulation internals and **Global live cutover** artifacts.

### What we extract

| Script                     | Output                                     | Role                                       |
| -------------------------- | ------------------------------------------ | ------------------------------------------ |
| `extract-course-data.ts`   | `src/modules/data/json/course_data.json`   | Course geometry                            |
| `extract-skills.ts`        | `src/modules/data/json/skills.json`        | Global skill cutover + provenance metadata |
| `extract-uma-info.ts`      | `src/modules/data/json/umas.json`          | Global outfit cutover                      |
| `extract-support-cards.ts` | `src/modules/data/json/support-cards.json` | Global support card cutover                |
| `extract-all.ts`           | All of the above                           | Primary master.mdb entrypoint              |

### Manifest tracking

After a successful course extraction, `data-manifest.json` is updated:

- `masterDb.extractedAt` — set to the extraction timestamp
- `masterDb.resourceVersion` — updated when provided explicitly or resolved from `uma.moe`

### Merge vs Replace

Entity and course extraction default to **merge mode** and preserve entries not present in the current `master.mdb`. Pass `--replace` for a clean rebuild.

## Runtime merge

At app init ([registry.ts](../../src/modules/data/registry.ts)):

1. `loadSkills()` — master `skills.json` + GameTora `gametora/skills.json`
2. `loadUmas()` — GameTora character cards; `releasedOutfits` from master `umas.json`
3. `loadSupportCards()` — GameTora cards; `released` from master `support-cards.json` keys
4. `attachSupportCardHintSources` / `attachSupportCardEventSources` — skill `supportSources` from GameTora cards

Consumers import service singletons directly: `skillsService`, `umasService`, `supportCardsService`, `coursesService`.

## Comparison / fallback tools

These scripts extract directly from `master.mdb` for diffing against GameTora. They are also run as part of `extract:all`:

| Script                     | Purpose                     |
| -------------------------- | --------------------------- |
| `extract-skills.ts`        | Master skill extract        |
| `extract-support-cards.ts` | Master support card extract |
| `extract-uma-info.ts`      | Master uma extract          |

## `fetch-support-events` Status

`fetch-support-events.ts` is redundant for the main pipeline. Support card events come from GameTora snapshots via `sync:data`.

## Output Files

### Primary pipeline outputs

| File                                       | Source            | Produced by                             |
| ------------------------------------------ | ----------------- | --------------------------------------- |
| `src/modules/data/json/gametora/*.json`    | GameTora          | `pnpm run sync:data`                     |
| `src/modules/data/json/skills.json`        | master.mdb        | `extract:skills` / `extract:all`        |
| `src/modules/data/json/umas.json`          | master.mdb        | `extract:uma-info` / `extract:all`      |
| `src/modules/data/json/support-cards.json` | master.mdb        | `extract:support-cards` / `extract:all` |
| `src/modules/data/json/course_data.json`   | master.mdb        | `extract:all`                           |
| `data-manifest.json`                       | manifest tracking | `sync:data`, course extraction          |

## Consequence of the split

- **master.mdb** defines what is live on Global and powers simulation geometry
- **GameTora** provides the full catalog and Global-correct skill conditions
- **`extract:all`** is the primary master.mdb extraction path (courses + cutover artifacts)

That separation matches [ADR-0001](../adr/0001-data-source-separation.md).
