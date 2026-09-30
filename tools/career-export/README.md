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

Needs Python 3.10 or newer and the `frida` package.

With plain Python:

```bash
pip install frida
python3 career_export.py --out career-export.json
```

On Windows use `py -3` if `python3` is not on PATH. If `pip install frida` hits
a permissions error, add `--user`, or work in a venv:

```bash
python3 -m venv .venv
source .venv/bin/activate           # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install frida
python3 career_export.py --out career-export.json
```

With [uv](https://docs.astral.sh/uv/), which reads the dependency header at the
top of the script and needs no install step:

```bash
uv run career_export.py --out career-export.json
```

Start it, then open the skill-learning screen of a running career. The hook
fires on `BeginView`, the file is written, and the script exits. Add `--debug`
to write `career_export.log`.

### Linux: Proton and Wine

Under Proton or Wine the client is a Windows PE inside a Linux process. A plain
Frida attach injects Frida's *Linux* agent there and crashes the client with
`bootstrapper crashed with signal 11` (see
[frida/frida#3339](https://github.com/frida/frida/issues/3339)). The script
handles this automatically: it finds the running Wine/Proton prefix, runs
Frida's *Windows* server inside it, and attaches through the remote device it
exposes, so the Windows agent is injected instead.

The matching `frida-server-<version>-windows-x86_64.exe` is downloaded once and
cached in `~/.cache/career-export/`. If auto-detection fails (a non-steam Wine
prefix, for example), point at the prefix directly:

```bash
python3 career_export.py --wine-prefix /path/to/pfx --out career-export.json
```

`--wine-binary` overrides the Wine loader, `--frida-server` reuses a server
you already have, and `--remote HOST:PORT` attaches through a server that is
already running. `--debug` is the fastest way to see which path was taken.

If it says the career object is not latched yet, leave the skill screen and
open it again. `WorkSingleModeData` goes quiet while a screen sits idle, so the
pointer it needs only appears once a career screen redraws.

The script refuses to write a file when the career read is incomplete. A JSON
with zeroed stats looks valid to whatever reads it and would silently produce a
wrong plan, which is worse than no file at all.

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

On Windows and macOS the script attaches to the client directly. On Linux it
first checks whether the target is a Wine/Proton process by reading
`WINEPREFIX` and `WINELOADER` from `/proc/<pid>/environ` (falling back to the
wineserver that owns the prefix). When it is, the script starts a Windows
`frida-server.exe` under the same loader and prefix, connects to it as a
remote device, and does all enumeration and attachment through it. The Linux
local device is never used for injection.

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
