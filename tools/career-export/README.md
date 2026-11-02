# Career export

Reads a live Umamusume career off the skill-learning screen and writes the same
career payload [umadump](https://github.com/Werseter/umadump) emits: an
API-shaped `single_mode/load` document.

```json
{
  "single_mode_load_common": {
    "chara_info": { "...": "59 keys" },
    "race_condition_array": [],
    "home_info": { "...": "typed placeholder" },
    "race_history": [],
    "win_saddle_id_array": []
  }
}
```

Keys, key order and nesting are taken from umadump's `decode_career_data`, so a
capture from this script and a capture from umadump are the same document and
can be compared without a translation step.

## What is read

`chara_info` is read in full: identity, stats and their caps, aptitudes, mood,
fans, talent level, SP balance, running style, scenario and route, the learned
skill list, shop hint levels, support cards, both succession parents, active
conditions and the nicknames and route races the career has picked up. Also read
in full:

| Section | Contents |
| --- | --- |
| `race_history` | turn, program, weather, ground, style, rank, frame order, NPC count |
| `race_condition_array` | program, weather, ground condition |
| `win_saddle_id_array` | every win-saddle id |

## What is a placeholder

Everything else is a typed placeholder, following umadump's own convention for
sources it cannot observe. **These are not reads.** Do not treat a `0` or an
empty array here as a fact about the career:

| Section | Why |
| --- | --- |
| `home_info` | the live training commands are not read; the placeholder is umadump's null-source shape |
| `unchecked_event_array`, `effected_factor_array`, `reserved_race_array`, `resume_factor_select` | not read |
| `race_start_info`, `race_scenario`, `race_reward_info`, `add_trophy_info`, `trophy_reward_info`, `prev_chara_grade`, `race_add_reward_info` | not read; all `null` or empty |
| `race_random_program_array`, `mission_list`, `story_event_mission_list`, `story_event_chara_bonus_list`, `start_dress_info` | not read |
| `chara_info.start_time` | `ObscuredString` is not decoded here, so this is always `""` |
| `chara_info.is_short_race` | `ObscuredBool` is not decoded here, so this is always `0` |
| `chara_info.evaluation_info_array`, `training_level_info_array`, `guest_outing_info_array`, `skill_upgrade_info_array` | not read |
| the scenario data set (`free_data_set`, `ura_data_set`, `live_data_set`, `team_data_set`) | **absent, not empty** — check with `.get()`, not `[...]` |

The scenario data set is the one place this document's shape differs from
umadump's. umadump always emits one because it reads the scenario state; this
script does not, so the key is omitted rather than filled with invented data.

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

The skill screen is only the trigger. Its shop listing is not read; the screen
is used because opening it routes through the career getters, which is what
latches the live objects.

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

If it says the career object is not latched yet, leave the skill screen and open
it again. `WorkSingleModeData` goes quiet while a screen sits idle, so the
pointer it needs only appears once a career screen redraws.

The script refuses to write a file when the core career read is incomplete. A
JSON with zeroed stats looks valid to whatever reads it and would silently
produce a wrong result, which is worse than no file at all.

## How it reads

Two latches, no singleton walking:

- `SingleModeSkillLearningViewController.BeginView` — the trigger. When it
  fires, the career objects are already latched, so the document is assembled
  and sent.
- `WorkSingleModeData` getters — latch the live career object off the game's own
  traffic, which avoids resolving a static singleton field whose layout differs
  across IL2CPP builds. `get_Character` also yields the trainee, and
  `WorkSingleModeCharaData.get_Speed` is a second chance at it.

Everything else is read **by metadata field name**, the way umadump does it: the
script walks the IL2CPP class table once, records each field's offset, and then
reads `object + offset`. Metadata spells an auto-property
`<Speed>k__BackingField`, so names are normalised to the camelCase form umadump
uses, and a class's base classes are walked too because several of these types
inherit their fields (`AcquiredSkill` takes `masterId` and `level` from
`SkillDataBase`).

A field that moves therefore reads as `null`, not as a number from the wrong
slot. The host turns a `null` into `0`, prints the list of fields that did not
resolve, and refuses to write at all when a core stat is among them. That report
line is the fastest signal that a client update moved something.

List and array counts are clamped before use. A garbage count there loops into
the millions and builds a payload past Frida's 128MiB IPC limit, which drops the
message and hangs the game.

On Windows and macOS the script attaches to the client directly. On Linux it
first checks whether the target is a Wine/Proton process by reading
`WINEPREFIX` and `WINELOADER` from `/proc/<pid>/environ` (falling back to the
wineserver that owns the prefix). When it is, the script starts a Windows
`frida-server.exe` under the same loader and prefix, connects to it as a
remote device, and does all enumeration and attachment through it. The Linux
local device is never used for injection.

## Verification status

The document shape is checked against umadump's encoder: `single_mode_load_common`
(21 keys), `chara_info` (59 keys), `race_history` entries, `race_condition_array`
entries and the `home_info` placeholder all match that project's key set and key
order exactly.

The scalar reads are unverified against a live client since the switch from
getters to field offsets. Check a run against the screen the first time a client
update lands; the "did not resolve" report line is the thing to watch.

One known unknown: `chara_effect_id_array` and `route_race_id_array` are arrays
of `ObscuredInt`, whose element stride is `OBSCURED_INT_SIZE` (`20`). That is
umadump's declared size for ACTk's full struct; a client built with the stripped
8-byte variant would make every element after the first garbage in those two
arrays. They are the only reads affected, and that constant is the one to change
if the values look wrong.

## Credits

The payload contract, field names and read strategy are derived from
[Werseter/umadump](https://github.com/Werseter/umadump). Skill-shop offsets in
earlier versions came from
[UmaExtractor](https://github.com/xancia/UmaExtractor).
