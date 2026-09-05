# Capture findings

What recorded races say about the engine. Every entry names the fixtures or
capture it came from and the command that reproduces it. Numbers are the
measurement, not a model of it. Where a finding is unexplained it says so.

`docs/mechanics/README.md` stays the mechanics source of truth. A finding here
that contradicts it gets a note there; so far none does.

## Evidence base

- 53 horseACT captures under `honse-sim-wasm/tests/fixtures/captures/`: 41
  Champions Meeting and 12 Room Match races, all Hanshin turf 1600 m (course
  10903), 9 runners each. Exported with torena-hub's `pnpm run race:fixture`.
- Three Room Match captures from the same course that started this work, not in
  the fixture set: `Mihono Bourbon-74.8213s-20260811.json`,
  `Silence Suzuka-74.8617s-20260811.json`, `Taiki Shuttle-74.7314s-20260821.json`.
- The game records every frame for the first second and near the finish, and
  about one frame per second in between. Per-second HP and speed deltas below
  come from those one-second frames.
- Harness: `cargo test -p honse-sim-wasm --test capture_accuracy -- --ignored --nocapture`.
  `ACCURACY_FIXTURE=<substring>` narrows the set, `ACCURACY_TRACE=<gate>`
  prints one runner frame by frame. "Pinned" below means gate, start delay,
  skill activations, last spurt transition, rushed spells and downhill mode
  taken from the recording; the engine rolls only section variance and dueling.

## HP consumption formula: confirmed

Fit of the game's recorded HP drain per second against its recorded speed,
31,502 one-second samples, rushed frames excluded, base speed
`20 - (1600 - 2000) / 1000 = 20.4`. Multiplier is recorded drain divided by
the documented `20 * (speed - base + 12)^2 / 144`.

| Where | n | Median multiplier | After dividing by guts modifier |
|---|---|---|---|
| Early, flat | 5203 | 1.003 | |
| Mid, flat | 14328 | 1.003 | |
| Mid, on the 950 to 1350 m downhill | 2295 | 0.548 | |
| Late (2/3 to 5/6), on the downhill | 5060 | 0.571 | |
| Final sixth, flat | 1043 | 1.335 | 1.004 |
| Final sixth, uphill | 1642 | 1.333 | 1.002 |

The downhill samples are bimodal, not a uniform 0.55. Mid-race downhill peaks
at 0.4 and 1.0. Late-race downhill peaks at 0.5 and 1.3, which are 0.4 and 1.0
times the guts modifier. So: the formula is exact on flat ground, the guts
multiplier applies from two-thirds of the course, and downhill mode is the
documented 0.4 factor. The engine has all three.

## Downhill mode share: open

Share of one-second downhill samples draining under 0.7 of the formula, 16
fixtures: game 0.570 (2105 samples), engine rolling freely 0.626 (18,092
samples over 8 seeds each). The engine enters the mode a little more often
than the game. Not pursued.

## Start-dash HP drain: unexplained

Capture `Mihono Bourbon-74.8213s-20260811.json`, gate 6, first second. The game
drains 1 to 2 HP every frame from the first frame, 16 HP by 1.0 s, while speed
climbs from 3.0 to 17.9 m/s. The documented formula on current speed gives 7 HP
over the same second, and that is what the engine drains. Speed and distance
match the game to 0.01 m/s and 0.1 m through the dash.

Across the 53 fixtures the engine carries about 6 more HP than the game
through the early phase, and the offset stays. No rule for it is known.

## Runaway is running style 1 plus skill 202051: fixed

Capture `Mihono Bourbon-74.8213s-20260811.json`, Silence Suzuka at gate 4,
running style 1, stamina 560 at Bad mood (549 base). Game HP at the gate is
1977, which is `0.8 * 0.86 * 549 + 1600`, the runaway coefficient. The front
runner coefficient gives 2017.

Run as a front runner the engine had 713 HP at 41 s and hit zero before the
line. Run as a runaway it had 1159 HP at 41 s, the game's exact value, and
finished within 0.05 s and in the same place. torena-hub's importer now applies
the rule (torena-hub#49). 14 runners across 12 fixtures changed strategy.

## Replay frame zero: fixed

The game's capture has a frame at time 0 with the field standing in the gates.
The engine's replay started at the first tick, so its frame k was one tick
after the game's frame k. Matched by index, the start dash read as a +0.55 m/s
early-phase speed bias on every race; matched by time the bias is +0.03. The
replay collector now records the gate frame (torena-sim#96).

## Last spurt transition: pinned to within a frame

With `forcedLastSpurtDistance` set from the recording, spurt-start MAE is
0.96 m over 53 fixtures. The remainder is the game logging the first frame past
the transition rather than the transition itself.

## Rushed: pinned with 0.999 frame agreement

With `forcedRushedRegions` from the recorded `temptationMode` and the engine's
roll disabled, frame agreement on rushed state is 0.999.

## Late-race speed excess is overtaking time: open

After every pin, the engine is still fast in the late race for pack runners
and not for leaders. Fixture `10903-mihono-bourbon-74-2859s-20260831`, pinned:

| Runner | Style | Late speed bias | Late HP bias |
|---|---|---|---|
| Oguri Cap, gate 2 | end closer | +0.49 m/s | −149 |
| Narita Taishin | end closer | +0.32 m/s | −84 |
| Special Week | pace chaser | +0.20 m/s | −58 |
| Seiun Sky | front runner | +0.06 m/s | −55 |
| Mihono Bourbon | front runner | +0.07 m/s | +5 |

Traced, Oguri Cap at gate 2 starts a full spurt at 1068 m with the same skills
fired at the same places as the engine. The raw capture marks him blocked by
gate 6, a pace chaser 1.7 m ahead in the next lane at 20.2 m/s, on the frames
at 53.3, 54.4 and 56.5 s. His speed holds near 20.1 for two seconds and near
21.1 for two more while his lane goes from 4699 to 5877 units between 53.3 and
59.7 s to get past. Once clear he
accelerates at 0.48 m/s², the documented base for his power. The engine's copy
is clear almost at once and accelerates at 0.98 m/s²: the same base plus the
unique skill's +0.3 and a gold skill's +0.2, both of which the game also fired
but which land on a capped runner there.

The capture records lane position per frame; the fixtures do not carry it yet.

## Career races: excluded

Career runners carry debut-level stats (speed 92, stamina 115 in one capture)
and the game grants +400 adjusted stats in single mode. Without that rule the
engine finished 7 to 11 s slow on 20 career captures. The exporter skips
`Single` and `Legend` captures.

## Pinned scores by change

Means over the 53 fixtures, pinned mode, 8 seeds.

| Change | Finish MAE | Finish bias | Spearman | Spurt MAE | Trajectory MAE | HP MAE |
|---|---|---|---|---|---|---|
| Harness lands (#92, Hanshin set) | 0.224 s | −0.085 s | 0.795 | 4.10 m | 5.28 m | |
| Runaways imported as Runaway (#93/#94) | 0.220 s | −0.090 s | 0.802 | 2.78 m | 5.23 m | |
| Spurt pinned (#94) | 0.221 s | −0.097 s | 0.809 | 0.96 m | 5.19 m | |
| Frames matched by time (#95) | 0.221 s | −0.097 s | 0.809 | 0.96 m | 4.77 m | 36.8 |
| Rushed pinned (#96) | 0.226 s | −0.094 s | 0.824 | | 4.72 m | 33.3 |
| Downhill pinned (#97) | 0.212 s | −0.068 s | 0.835 | | 4.67 m | 22.3 |

Speed bias by phase after #97, early / mid / late: +0.031 / +0.043 / +0.055 m/s.
