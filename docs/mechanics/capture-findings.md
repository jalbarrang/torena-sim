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

## Lane trajectory: measured, model open

Lane MAE in meters from the rail, pinned, 53 fixtures, engine replay lane
scaled by course width like the game (10000 units per width, gate k at k/18):

| Strategy | Runners | Lane MAE |
|---|---|---|
| Front runner | 50 | 0.71 m |
| Pace chaser | 203 | 1.31 m |
| Late surger | 122 | 1.24 m |
| End closer | 88 | 1.51 m |
| Runaway | 14 | 0.85 m |

Traced on the same race as above, gate 2: the game moves the closer out to
2.8 m in the first five seconds and back to 0.7 m by mid-race; the engine
leaves him in his gate lane at 1.25 m and drifts in from 20 s. From 40 s both
move out; the game reaches 6.8 m, the engine stops at 4.13 m from 53 s on.

Applying the documented front-block speed cap (0.988 to 1.0 times the
blocker's speed under 2 m) without the documented target-lane rules made
things worse: pinned finish MAE 0.212 s to 0.352 s, order Spearman 0.835 to
0.612, finish bias flipped to +0.21 s. With the cap, the engine held runners
front-blocked in 9 to 20% of late-race frames by strategy; the game's recorded
blocker column is near zero in the same frames. The engine does not spread
the pack the way the game's rules do (two horse lanes from the runner inside
in mid-race, candidate lanes in overtake mode), so its pack stacks and stays
capped. The cap is wired but off until those rules land.

## Lane units: fixed, one constant held back

The doc's lane section measures lanes in course widths (11.25 m on this
course); the engine measured them in meters and had read the doc's constants
unscaled. Fixture `10903-mihono-bourbon-74-2859s-20260831`, gate 2, power 1140:

- Lane change speed. The game moves him out at 0.33 m/s from 41.6 to 52.2 s.
  The documented `0.02 * (0.3 + 0.001 * power)` is 0.0293 per second; in
  widths that is 0.33 m/s. The engine had moved 0.0293 m per tick.
- Final-corner lane. The corner starts at 800 m and every runner moves out
  from there, the leader included. Runners at 1.10 to 1.33 m from the rail
  settle at 6.10, 6.61 and 6.28 m; runners on the rail settle between 0.26 and
  1.04 m. The documented `clamp(lane / 0.1, 0, 1) * 0.5 + random(0.1)` in
  widths gives 5.5 to 6.6 m for the first group and 0 to 1.1 m for the second.
  The engine had used meters with no clamp, so the random part was 0.1 m and
  a runner at 1.25 m targeted 6.3 m.
- Inward drift. Normal-mode rule 4 moves the target 0.05 widths in, 0.56 m;
  the engine had used 0.05 m.

With the three in widths (torena-sim#101), pinned means over 53 fixtures:
finish MAE 0.205 to 0.203 s, trajectory 4.61 to 4.55 m, lane MAE 1.00 to
0.98 m, Spearman 0.815 to 0.809.

The pace-down lane, 0.18 in the doc, stays in meters. Read as widths (2.0 m)
the pinned finish MAE is 0.217 s, and fixture
`10903-special-week-74-3953s-20260830` goes from 0.208 to 0.626 s: its whole
field runs 0.2 to 0.3 m/s slow through the mid-race and finishes 0.6 to 1.0 s
late. The paced-down runner parks inside the bunch and the runners behind it
stay front-blocked and speed-capped. Whether the game's value is 0.18 widths
and the engine's bunching is the real difference is open.

Firing normal-mode rule 3 from the final corner as well as the final straight,
which the leader's move at 800 m suggests, changed nothing: finish MAE 0.206 s,
lane MAE 0.99 m. Not applied.

## Closer's corner lane: open

Same fixture, gate 2, after the unit fix. The game holds him at 1.10 m from
8.5 s to 40 s, which is 1.76 horse lanes off the runners on the rail, the
edge of normal-mode rule 5. The engine drifts him to 0.42 m by 40 s. The
final-corner lane is set from the lane at the corner entry, so the game sends
him to 6.6 m and the engine to 2.3 m, and he spurts inside the pack instead
of around it. He finishes 0.92 s early in the engine.

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
| Target-lane rules and blocking cap (#100) | 0.205 s | +0.007 s | 0.815 | | 4.61 m | 21.5 |
| Lane constants in course widths (#101) | 0.203 s | −0.003 s | 0.809 | | 4.55 m | 21.1 |

Speed bias by phase after #97, early / mid / late: +0.031 / +0.043 / +0.055 m/s.
