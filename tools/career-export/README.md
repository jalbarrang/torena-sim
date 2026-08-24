# Career export

Reads a live Umamusume career off the skill-learning screen and writes a
`SkillPlannerExportData` JSON document.

That shape is a skill-planning tool's own import/export format, so a capture
taken from the game and a plan shared between players are the same file, and a
planner can consume it without any conversion step.

## What it captures

| Field | Source |
| --- | --- |
| `card_id`, stats, aptitudes, `mood` | `WorkSingleModeCharaData` getters |
| `strategy` | `WorkSingleModeData.GetCardRunningStyle(cardId)` |
| `budget` (SP balance) | `<SkillPoint>k__BackingField` (ObscuredInt) |
| `fast_learner` | `CharaEffectIdArray` contains effect id 7 |
| `obtained_skills` | Skill shop entries flagged acquired |
| `candidate_skills` | The rest, with hint level and the game's own price |

`strategy` is the style the trainee last raced with, read through
`WorkSingleModeData.GetCardRunningStyle(cardId)`. If that read gives nothing
usable it falls back to the highest running-style aptitude; the run says which
of the two it used.

`game_cost` is the game's own base price. The planner never applies it — it is
read purely to cross-check the planner's skill data against the live client, and
a disagreement is reported in the import dialog.

## Usage

```bash
uv run career_export.py --out career-export.json
```

Start it, then open the skill-learning screen of a **running career**. The hook
fires on `BeginView`, the file is written, and the script exits. Add `--debug`
to write `career_export.log`.

The script refuses to write a file when the career read is incomplete. A JSON with zeroed stats looks valid to the planner and would
silently produce a wrong plan, which is worse than no file at all.

## How it reads

Two hooks, no singleton walking:

- `SingleModeSkillLearningViewController.BeginView` — the shop listing. Entry
  fields sit at fixed offsets (`16` id, `20` level, `32` acquired, `52` base
  cost, `60` hint level) in the nested `SkillInfo` list.
- `WorkSingleModeData.get_Character` and `WorkSingleModeCharaData.get_Speed` —
  latch the live career object off the game's own traffic, which avoids
  resolving a static singleton field whose layout differs across IL2CPP builds.

Two latches rather than one because a hook only sees calls made *after* it is
installed. Start the script while the skill screen is already open and
everything that screen read on the way in has already happened; the career
object is then still cold when `BeginView` fires. When that happens the script
says so and keeps running — leaving the screen and opening it again routes
through `get_Character` and completes the export.

List counts from the shop hook are clamped before use. A garbage count there
loops into the millions and builds a payload past Frida's 128 MiB IPC limit,
which drops the message and hangs the game.

## Verification status

The shop-side offsets are verified against a real capture: decoding a recorded
`BeginView` payload reproduces a known-good decode exactly — 8 acquired, 53
buyable, every hint level and base cost matching.

The career-side reads are confirmed against a live client: card id, all five
stats, aptitudes, mood, SP balance, active conditions and the recorded running
style all came back matching the game, and the learned/shop split reconciled
against the raw entry count.

Cross-checking `game_cost` against an independently maintained skill dataset
found zero disagreements across 59 shop rows, so both sides agree on pricing.

The script still prints everything it read on every run. Check it against the
screen the first time a client update lands — a moved field shows up as a
zeroed stat or a style that reports itself as guessed.

## Credits

Skill-shop offsets and the IL2CPP class-scan approach are derived from
[UmaExtractor](https://github.com/xancia/UmaExtractor).
