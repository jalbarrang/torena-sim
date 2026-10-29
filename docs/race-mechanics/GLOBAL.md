# Race Mechanics — Global Reference

Distilled from KuromiAK's [race-mechanics guide](./README.md), scoped to **what is live on the
Global release**. Every formula and constant below is transcribed from the chapters; nothing is
inferred except where explicitly marked.

**How to use this file.**

- It is a **lookup spec**: check a formula, a threshold, a coefficient or a branch condition here.
- Open the linked chapter when you need the reasoning, the reverse-engineering caveats or the
  full procedure (this file keeps the numbers and the branch rules, not every derivation).
- **Confidence markers used inline:**
  - nothing — reverse-engineered and confirmed by the author.
  - `⚠️ inferred` — the author infers this from the game's parameter file; details still under
    investigation.
  - `⚠️ JP-only` — not live on Global yet. Kept so you recognise it in JP-sourced material.
- Original chapter-level caveats worth knowing: **Compete Before Spurt**, **Secure Lead** and
  **Stamina Limit Break** are all `⚠️ inferred`.

---

## 0. Global scope

### Scenarios live on Global

Read from the Global client's own master data (`single_mode_scenario`), in release order:

| Scenario | Global release |
| --- | --- |
| The Beginning: URA Finale | launch |
| Unity Cup: Shine On, Team Spirit! | 2025-11-06 |
| Trackblazer: Start of the Climax | 2026-03-12 |
| Brighter Together / Our Grand Concert (**Grand Concert**, JP: Grand Live) | 2026-07-22 |

**Newest scenario: Grand Concert** (JP: Grand Live). Not on Global: Grandmasters, L'arc, UAF, Grand Food Festival,
Mecha, Twinkle Legends, Design Your Island, Onsen, Breeders' Cup, Tracen-ken/Ramen.

### Stat caps

| Cap | Global value |
| --- | --- |
| Training / in-career stat cap | **1200** (raised by blue/factor stat uncaps) |
| Race-engine stat clamp | **2000** (max attainable race stat is 2000) |
| Raw stats above 1200 | **halved** before conversion to base stats |

`⚠️ JP-only` — both caps were raised to **2500** on the JP 5th anniversary. That does not apply
to Global; the race engine clamps at 2000 and the in-career cap is 1200.

### Skill scaling types that Global can actually reach

| Scaling type | Applies on Global | Why |
| --- | --- | --- |
| Aoharu skills (3–7) | yes | Unity Cup is live |
| Climax skills (10) | yes | Trackblazer is live |
| `MultiplyArcGlobalPotentialLevel` (24) | `⚠️ JP-only` | L'arc scenario is not on Global |
| `MultiplyMaximumRawStatus` (13), `MultiplySpeed` (22/23) | yes | pure stat scaling |

### Scope decisions (judgement calls recorded)

Two judgement calls are recorded here, plus how JP-only content is handled:

- **Runaway / Oonige is included as live.** The Global reference doc states it released with the
  Unity Cup scenario; note that the Global client's card data currently has no Runaway-style uma
  and no oonige aptitude column, so this is a judgement call rather than a certainty.
- **The JP 1.5-anniversary position-keep changes are treated as live** (Pace Up Ex mode, the
  mid-race Pace Down lerp, the 12.5 m pacemaker thresholds, the 0.945x mid-race Pace Down
  coefficient and the −0.5 m/s² Pace Down deceleration). Global runs a later client than JP did
  at the same content stage.
- Genuinely JP-later mechanics are kept in the body but flagged `⚠️ JP-only` so they are not
  planned around. See §17.

---

## 1. Time, distance and phase units

| Unit | Value |
| --- | --- |
| Simulation tick (frame) | **0.0666 s** (≈15 fps) |
| Section | 24 equal-distance divisions of the course, numbered **1–24** |
| Bashin (horse length) | **2.5 m** |
| Course width | **11.25 m** |
| Horse lane | **1/18 course width** (= 0.625 m) |
| Target speed ceiling | **30 m/s** |

### Phases

| Phase | Name | Sections |
| --- | --- | --- |
| 0 | Early-race 序盤 | 1–4 |
| 1 | Mid-race 中盤 | 5–16 |
| 2 | Late-race 終盤 | 17–20 |
| 3 | Last Spurt 最終盤 | 21–24 |

**Gotcha:** the *last spurt phase* (phase 3) is not the same thing as the *last spurt* mechanic
(section 4). Skills that say "phase == 2" mean late-race, not the final spurt.

Replay position sampling: every frame within 1 s of the start, and within 25 m of the goal;
otherwise every 16 frames.

---

## 2. Stats

`FinalStat = AdjustedStat + SkillModifier` — "stat" in every formula below means this final stat
unless stated otherwise.

### Raw → base → adjusted

```
BaseStat      = (RawStats + AoharuTeamRankBonus) * MotivationCoef
AdjustedSpeed = BaseSpeed   * RaceCourseModifier + GroundModifier + SingleModeModifier
AdjustedStam  = BaseStamina                    + SingleModeModifier
AdjustedPower = BasePower                      + GroundModifier + SingleModeModifier
AdjustedGuts  = BaseGuts                       + SingleModeModifier
AdjustedWiz   = BaseWiz * StrategyProficiencyModifier + SingleModeModifier
```

- Raw stats past **1200** are **halved** before becoming base stats.
- **Single mode (training) gives every uma +400 adjusted stats.**
- Base stat (not final stat) is what feeds **skill activation chance** and **Aoharu skill scaling**.

**Motivation coefficient**

| 絶好調 | 好調 | 普通 | 不調 | 絶不調 |
| --- | --- | --- | --- | --- |
| 1.04 | 1.02 | 1.0 | 0.98 | 0.96 |

**Strategy proficiency modifier** (applies to adjusted Wiz only)

| S | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 1.0 | 0.85 | 0.75 | 0.6 | 0.4 | 0.2 | 0.1 |

**Ground modifier — speed**

|  | Firm 良 | Good 稍重 | Soft 重 | Heavy 不良 |
| --- | --- | --- | --- | --- |
| Turf | 0 | 0 | 0 | −50 |
| Dirt | 0 | 0 | 0 | −50 |

**Ground modifier — power**

|  | Firm 良 | Good 稍重 | Soft 重 | Heavy 不良 |
| --- | --- | --- | --- | --- |
| Turf | 0 | −50 | −50 | −50 |
| Dirt | −100 | −50 | −100 | −100 |

**Race course modifier (threshold stats)** — some courses nominate 1–2 stats as thresholds;
exceeding the threshold adds a multiplier to **adjusted speed**:

| Base stat | Bonus |
| --- | --- |
| ≤ 300 | +0.05x |
| 301–600 | +0.1x |
| 601–900 | +0.15x |
| > 900 | +0.2x |

With two threshold stats the bonus is the **average** of the two. Max possible is +0.2x.

---

## 3. Target speed and base speed

```
TargetSpeed = (BaseTargetSpeed | LastSpurtSpeed) * PositionKeepCoef
            + ForceInModifier + SkillModifier + SlopeModifier + MoveLaneModifier
```

Clamped to `[MinimumSpeed, 30 m/s]`. Position keep coefficient is in §9.

**Force-in modifier** — applied in early-race when the uma is more than **0.12 course width**
from the inner fence *and* the inside is blocked. The random component is rolled **once at race
start**.

```
ForceInModifier = Random(0.1) + StrategyModifier   [m/s]
```
Strategy modifier: Front Runner **0.02**, Pace Chaser **0.01**, Late Surger **0.01**,
End Closer **0.03**.

**Move-lane modifier** — applied when a lane-speed-modifying skill is active *and* the uma moved
lane on the previous frame:

```
MoveLaneModifier = (0.0002 * PowerStat) ** 0.5   [m/s]
```

### Slope modifier

- **Uphill:** lose target speed equal to `SlopePer * 200 / PowerStat`.
- **Downhill:** each second, chance `WizStat * 0.04%` to enter downhill-accel mode →
  `+0.3 + abs(SlopePer)/10 m/s` target speed and **−60% HP consumption**. Each second it has a
  **20%** chance to end.

### Base speed

```
BaseSpeed = 20.0 - (CourseDistance - 2000m) / 1000    [m/s]
```
1200 m → 20.8 · 2000 m → 20.0 · 2500 m → 19.5

### Base target speed

```
early-race & mid-race:
    BaseTargetSpeed = BaseSpeed * StrategyPhaseCoef

late-race & last spurt:
    BaseTargetSpeed = BaseSpeed * StrategyPhaseCoef
                    + sqrt(500 * SpeedStat) * DistanceProficiencyModifier * 0.002
```

**Key consequence: the Speed stat does nothing for target speed before the late-race.** Only
Wit (via per-section randomness) moves early/mid target speed.

**Strategy phase coefficient**

| Strategy | Early-race | Mid-race | Late-race & Last Spurt |
| --- | --- | --- | --- |
| Front Runner | 1.0 | 0.98 | 0.962 |
| Pace Chaser | 0.978 | 0.991 | 0.975 |
| Late Surger | 0.938 | 0.998 | 0.994 |
| End Closer | 0.931 | 1.0 | 1.0 |
| Oonige | 1.063 | 0.962 | 0.95 |

**Distance proficiency modifier (target speed)**

| S | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.6 | 0.4 | 0.2 | 0.1 |

**Randomness per section** — at each section, `BaseSpeed × random` is added to target speed.
Does **not** apply during the last spurt.

```
Max = WizStat/5500 * log10(WizStat * 0.1)          [%]
Min = WizStat/5500 * log10(WizStat * 0.1) - 0.65   [%]
```
400 Wiz → +0.117% / −0.533% · 800 Wiz → +0.277% / −0.373%

---

## 4. Last spurt

Computed at the **start of late-race**, without per-section randomness.

```
LastSpurtSpeedMax = (BaseTargetSpeed_phase2 + 0.01 * BaseSpeed) * 1.05
                  + sqrt(500 * SpeedStat) * DistanceProficiencyModifier * 0.002
                  + (450 * GutsStat) ** 0.597 * 0.0001      [m/s]
```

If the uma has enough HP to run the remaining distance at max target speed, she starts the last
spurt immediately at `LastSpurtSpeedMax`.

If HP is insufficient:

1. Build candidates by lowering target speed by **0.1 m/s** per step, down to late-race base
   target speed.
2. Sort candidates by projected finish time (distance ÷ speed, **ignoring acceleration**).
3. Best-first, each candidate is accepted with chance `15 + 0.05 * WizStat` **%**.
4. If all fail the wisdom check, the **slowest** candidate is used.

The calculation estimates stamina usage to **60 m before the goal** and ignores acceleration time.
An HP recovery skill activating in late-race **triggers a recalculation**; debuffs do **not**.

**Minimum speed**

```
MinSpeed = 0.85 * BaseSpeed + sqrt(200.0 * GutsStat) * 0.001    [m/s]
```
Out of HP ⇒ target speed becomes minimum speed. Minimum speed is enforced after each frame's
acceleration step (post start dash).

**Starting speed:** 3 m/s.

**Blocking speed cap:** the blocked uma is capped between **0.988x** (at 0 m gap) and **1.0x**
(at 2 m gap) of the uma in front, scaled linearly.

**Current vs actual speed.** *Current speed* is the result of acceleration integration and drives
HP consumption. *Actual speed* = current speed + current-speed modifiers, applied instantly;
it is what determines distance travelled, blocking and overtaking.

---

## 5. Acceleration and deceleration

```
Accel = BaseAccel * sqrt(500 * PowerStat) * StrategyPhaseCoef
      * GroundTypeProficiencyModifier * DistanceProficiencyModifier
      + SkillModifier + StartDashModifier
```

`BaseAccel = 0.0006 m/s²` normally; **0.0004 m/s² on uphill**.

**Strategy phase coefficient**

| Strategy | Early-race | Mid-race | Late-race & Last Spurt |
| --- | --- | --- | --- |
| Front Runner | 1.0 | 1.0 | 0.996 |
| Pace Chaser | 0.985 | 1.0 | 0.996 |
| Late Surger | 0.975 | 1.0 | 1.0 |
| End Closer | 0.945 | 1.0 | 0.997 |
| Oonige | 1.17 | 0.94 | 0.956 |

**Ground type proficiency modifier (accel)**

| S | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.7 | 0.5 | 0.3 | 0.1 |

**Distance proficiency modifier (accel)**

| S | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.6 | 0.5 | 0.4 |

### Start dash

- Adds **+24.0 m/s²**.
- Ends when speed reaches `0.85 * BaseSpeed`.
- Speed is **hard-capped at `0.85 * BaseSpeed`** until the start-dash modifier is removed, so the
  extra acceleration cannot be carried past the threshold.
- The trigger ignores current-speed modifiers (this fixed a bug where a speed debuff could trap a
  uma in start dash).
- On a course that starts uphill with low Power, the uma can stay stuck in start dash because
  target speed is below the threshold.
- After a start dash ends, speed is normally below minimum speed → the uma is snapped up to
  minimum speed.

### Deceleration

| Situation | Deceleration |
| --- | --- |
| Early-race | −1.2 m/s² |
| Mid-race | −0.8 m/s² |
| Late-race | −1.0 m/s² |
| Pace Down mode (overrides all) | −0.5 m/s² |
| Out of HP (overrides all) | −1.2 m/s² |

---

## 6. HP and stamina

```
MaxHP = 0.8 * StrategyCoefficient * StaminaStat + CourseDistance    [m]
```

**HP strategy coefficient**

| Front Runner | Pace Chaser | Late Surger | End Closer | Oonige |
| --- | --- | --- | --- | --- |
| 0.95 | 0.89 | 1.0 | 0.995 | 0.86 |

```
HPConsumptionPerSecond = 20.0 * (CurrentSpeed - BaseSpeed + 12.0)^2 / 144.0
                       * StatusModifier * DownhillAccelModeModifier * GroundModifier
```

**Status modifier**

| State | Multiplier |
| --- | --- |
| Front Runner Spot Struggle + Rushed | 3.6x |
| Oonige Spot Struggle + Rushed | 7.7x |
| Front Runner Spot Struggle | 1.4x |
| Oonige Spot Struggle | 3.5x |
| Rushed | 1.6x |
| Pace Down | 0.6x |
| Otherwise | 1.0x |

Downhill-accel mode multiplies HP consumption by **0.4**.

**Ground HP modifier**

|  | Firm | Good | Soft | Heavy |
| --- | --- | --- | --- | --- |
| Turf | 1 | 1 | 1.02 | 1.02 |
| Dirt | 1 | 1 | 1.01 | 1.02 |

**Late-race / last spurt guts penalty**

```
GutsModifier = 1.0 + 200 / sqrt(600.0 * GutsStat)
```
200 Guts → 1.577x · 400 → 1.408x · 600 → 1.333x

**Recovery skills** restore a percentage of **max HP**, instantly. Overflow is wasted. Every
recovery skill behaves identically apart from trigger and amount.

**Out of HP** ⇒ target speed is set to minimum speed.

---

## 7. Skills

Skill list and per-skill conditions: <https://gametora.com/umamusume/skills>.

### Activation chance

```
ActivationChance = max(100 - 9000 / BaseWiz, 20)   [%]
```
300 Wiz → 70.0% · 600 → 85.0% · 900 → 90.0% · 1200 → 92.5%

This is a **pre-race** wisdom roll, and it uses **base** Wiz — so it is *not* affected by strategy
proficiency or skills.

### Duration and cooldown

```
Duration = BaseDuration * CourseDistance[m] / 1000
Cooldown = BaseCooldown * CourseDistance[m] / 1000
```

### Conditions (branch rules an agent will actually hit)

| Condition | Behaviour |
| --- | --- |
| `x_random` | Picks a **10 m segment** before the race; fires when all other conditions hold while on that segment. |
| `straight_random` | Picks a straight segment (equal chance per straight, **regardless of length**), then a 10 m segment inside it. |
| `corner_random` | If the course runs the same corner multiple times, activates on the **last** lap. |
| `all_corner_random` | Up to **4 triggers** placed as: pick a corner (equal chance each), place a 10 m trigger, keep the ≥10 m remainder as a new candidate or discard, drop all candidates before it, repeat. Practical effect: uniform placement, latest start is `EndOfCorner − 10 m`. |
| `phase_corner_random` | All corners in the phase are "stitched together", so trigger probability is **proportional to corner length**. |
| `phase` | Activation is checked **before** the phase update. So `phase==1 & corner==0` can fire on the exact frame the uma exits a corner and enters late-race. |
| `remain_distance` | Distance is `courseDistance − floor(position)`, so `remain_distance >= 399` can actually fire at `398.000001`. |
| `order_rate` | Converted to an order condition, **rounded to nearest**. `order_rate > 50` in a 9-uma race → `9 × 50% = 4.5 ≈ 5` → `order > 5`, i.e. 6th or below. |
| `order_rate_inXX_continue` | Must stay in the top XX% until activation. The **first 5 seconds do not count**. |
| `near_count` | Near = `abs(DistanceGap) < 3 m` **and** `abs(LaneGap) < 3 horse lanes`. |
| `is_surrounded` | Needs another uma in **all 3** directions (one uma may satisfy several): out `abs(dGap)<1.5 m; 0<LaneGap<3 HL` · front `0<dGap<3.0 m; abs(LaneGap)<1.5 HL` · behind `−3.0<dGap<0; abs(LaneGap)<1.5 HL`. |
| `behind_near_lane_time` / `infront_near_lane_time` | `abs(DistanceGap) < 2.5 m` and `abs(LaneGap) < 1 horse lane`, checked against the uma exactly 1 place ahead/behind. Timers **reset when placement changes**. |
| `activate_count_x` | Skills are checked in **ID order**, so a lower-ID skill can trigger a higher-ID skill on the same frame, never the reverse. |

### Targeting

- Skills do **not** distinguish friend from foe when *targeting*: teammates can trigger and be
  targeted by skills and count towards a skill's maximum target count.
- Teammates are excluded from **debuff effects**.

### Skill level scaling

| Level | Target Speed | Accel | Stat | Everything else (recovery, current speed, lane move) |
| --- | --- | --- | --- | --- |
| 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| 2 | 1.01 | 1.02 | 1.01 | 1.02 |
| 3 | 1.04 | 1.04 | 1.02 | 1.04 |
| 4 | 1.07 | 1.06 | 1.03 | 1.06 |
| 5 | 1.10 | 1.08 | 1.04 | 1.08 |
| 6 | 1.13 | 1.10 | 1.05 | 1.10 |
| 7 | 1.16 | 1.125 | 1.06 | 1.12 |
| 8 | 1.19 | 1.15 | 1.07 | 1.14 |
| 9 | 1.22 | 1.175 | 1.08 | 1.16 |
| 10 | 1.25 | 1.20 | 1.10 | 1.18 |

### Ability-value scaling

| ID | Name | Scaling |
| --- | --- | --- |
| 1 | Direct | none |
| 2 | MultiplySkillNum | `min(1 + 0.01 * NumSkill, 1.2)` |
| 3–7 | Aoharu | total **base** stats: <1200 → 0.8x · 1200–1799 → 0.9x · 1800–2599 → 1.0x · 2600–3599 → 1.1x · ≥3600 → 1.2x |
| 8, 9 | MultiplyRandom | 60% → 0.0x · 30% → 0.02x · 10% → 0.04x |
| 10 | Climax | races won in training: <6 → 0.8x · 6–13 → 0.9x · 14–17 → 1.0x · 18–24 → 1.1x · ≥25 → 1.2x |
| 13 | MultiplyMaximumRawStatus | max raw stat: <600 → 0.8x · 600–799 → 0.9x · 800–999 → 1.0x · 1000–1099 → 1.1x · ≥1100 → 1.2x |
| 14 | MultiplyActivateSpecificTagSkillCount | green skills (tag 601–615) activated: 0–2 → 0.0x · 3–4 → 1.0x · 5 → 2.0x · 6+ → 3.0x |
| 19 | AddDistanceDiffTop | <20 m from 1st → +0.0 · ≥20 m → +0.1 |
| 20 | MultiplyBlockedSideMaxContinueTimePhaseMiddleRun | longest single mid-race blockage on either side: <2 s → 1.0x · <4 s → 2.0x · <6 s → 3.0x · ≥6 s → 4.0x (timer resets only when **both** sides clear) |
| 21 | same as 20 | **not implemented** |
| 22 | MultiplySpeed | final Speed: <1700 → 0.0x · 1700–1799 → 1.0x · 1800–1899 → 2.0x · 1900–1999 → 3.0x · ≥2000 → 4.0x |
| 23 | MultiplySpeed (type 2) | <1400 → 1.0x · 1400–1599 → 2.0x · ≥1600 → 3.0x |
| 24 | MultiplyArcGlobalPotentialLevel | `⚠️ JP-only` (L'arc): Lv<10 → 1.0x · 10–19 → 1.1x · ≥20 → 1.2x |
| 25 | MultiplyTopLeadAmount | max lead over 0–66.6% of the course: <10 m → 1.0x · 10–24 m → 1.4x · ≥25 m → 1.8x |

### Duration scaling

| ID | Name | Scaling |
| --- | --- | --- |
| 1 | Direct | none |
| 2 | MultiplyDistanceDiffTop | `BaseDuration * min(0.8 + DistanceFromTop/62.5m, 1.6)` |
| 3 | MultiplyRemainHp (Mejiro Bright, Mejiro McQueen) | HP <2000 → 1.0x · 2000–2399 → 1.5x · 2400–2599 → 2.0x · 2600–2799 → 2.2x · 2800–2999 → 2.5x · 3000–3199 → 3.0x · 3200–3499 → 3.5x · ≥3500 → 4.0x |
| 7 | MultiplyRemainHp (Matikane Tannhauser) | <1500 → 1.0x · 1500–1799 → 1.5x · 1800–1999 → 2.0x · 2000–2099 → 2.5x · ≥2100 → 3.0x |
| 4 | IncrementOrderUp | +1 s per successful overtake during the skill, max 3, and that extra time also scales with course distance |
| 5 | MultiplyBlockedSideMaxContinueTimePhaseMiddleRun | same bands as ID 20 |
| 6 | same as 5 | **not implemented** |

### Additional activate

Applies **while the skill is active** when a condition is met, for the remaining duration; can
trigger repeatedly.

| ID | Name | Rule |
| --- | --- | --- |
| 1 | OrderUp | each successful overtake, max 3 |
| 2 | AdditionalActivateActivateAnySkill | each time the uma activates another skill, max 3 |
| 3 | same | max 2 |

---

## 8. Lane

- 1 course width = **11.25 m**; 1 horse lane = **1/18 course width**.
- Lane distance minimum **0**; maximum is per course — the widest is **Tokyo turf at 1.5 course
  widths**, the narrowest **1.1** (Sapporo / Hakodate / Niigata dirt). Only Nakayama 2000 m and
  some Hanshin distances change max lane mid-race.
- Initial lane = `(HorseIndex + Adjustor) * HorseLane`, where Adjustor is **0** for
  Ooi/Kawasaki/Funabashi, **1.86** if gate ≥ 15 at Longchamp, **0.6** if gate ≥ 10 on other
  JRA courses.

### Lane change speed

```
TargetSpeed = 0.02 * (0.3 + 0.001 * PowerStat) * FirstMoveLanePointModifier * OrderModifier
FirstMoveLanePointModifier = 1 + LaneDistance / MaxLaneDistance * 0.05   (early & mid race, before the move-lane point)
OrderModifier              = 1 + Order * 0.01                            (late race & last spurt)
Accel                      = 0.02 * 1.5                                  (constant)
ActualSpeed                = clamp(CurrentSpeed + SkillModifier, 0, 0.6) * DirectionModifier
DirectionModifier (out)    = 1
DirectionModifier (in)     = -(1 + LaneDistance)
```

Current lane speed is non-directional and **resets to 0** when the target lane is reached. If
blocked in the direction of travel the lane does not change, but the uma keeps accelerating and
banks lane speed.

### Target lane

Updated when the uma is **< 0.5 horse lane** from the target, or when blocked on the side it is
moving towards. Three strategies: **normal**, **overtake**, **fixed**.

**Overtake targets** — all visible uma 1–20 m ahead where `distanceGap / speedGap < 15`
(catchable within 15 s at the current speed difference) **and** either their target speed is lower
than yours, or they are blocked with a current speed below your target speed. The closest uma
blocking you in front is always an overtake target.

**Normal mode** (no overtake targets, or within 200 m before the move-lane point in early/mid
race), evaluated in order:

1. Out of HP → target lane = current lane.
2. Position keep mode is Pace Down → target lane = **0.18**.
3. During/after the final corner, if the extra move lane is on the outside and unblocked → use it.
4. Early/mid race → current lane − **0.05** if unblocked.
5. Mid race and < **1.75 horse lane** from the inside uma → **2.0 horse lane** away from it.
6. Otherwise keep straight.

**Overtake mode** — entered when overtake targets exist; persists **1.5 s** after the last one is
lost. Candidates: for each overtake target, take the innermost and outermost uma of its crowd
(`0 ≤ dGap ≤ 3.0`, `0 < laneGap < 2 HL`), and propose `±1 horse lane` from each, keeping only
candidates with no visible uma within
`ownerDistance ≤ distance ≤ crowdEdgeDistance + 0.5` and
`candidate ± 0.8 horse lane`. One extra candidate: in early/mid race, 1 horse lane inward if ≥1 HL
from the fence; otherwise going straight. Candidates are scored and the **lowest** wins:

```
Score = abs(CandidateLane - LaneDistance) * PhaseCoef
```
PhaseCoef inside/outside: early **1.0 / 100.0**, mid **1.0 / 1.0**, late & last spurt
**1.0 / 1.15**. If the accepted candidate is inside the extra move lane and there is room, the
extra move lane is used instead.

**Fixed mode** — used when a skill dictates a target lane; that lane is used unless blocked.

**Extra move lane (final corner lane)** — on entering the final corner:
`clamp(LaneDistance/0.1, 0, 1) * 0.5 + random(0.1)`.

### Blocking

```
Front block  : 0 < DistanceGap < 2 m
               abs(LaneGap) <= (1.0 - 0.6 * DistanceGap/2m) * 0.75 horse lane
               → blocked speed = (0.988 + 0.012 * (DistanceGap/2m)) * leading uma's speed

Side block   : abs(DistanceGap) < 1.05 m  and  abs(LaneGap) < 2 horse lane
               → the uma with the lowest lane gap sets the space available

"blocked on all sides" = blocked in front AND on at least one side

Overlapping  : abs(DistanceGap) < 0.4 m  and  abs(LaneGap) < 0.4 horse lane
               → the outside uma is bumped 0.4 horse lane outward and updates its target lane
```

### Vision

```
Visible if DistanceGap <= VisibleDistance
       and abs(LaneGap) <= ((DistanceGap / VisibleDistance) * 11.5 HL + 2 HL) / 2
```
Visible distance starts at **20 m** and is only changed by skills. The cone's maximum width is
constant regardless of visible distance.

---

## 9. Position keeping

Active between **sections 1–10**. Modes: normal, plus front-runner (speed up, overtake),
non-front-runner (pace up, pace down), and the shared pace up ex.

- Normal mode multiplier is **1.0x**.
- While in normal mode, a mode-entry check runs **every 2 seconds**.
- The uma exits after the exit condition is met, or after running **1 section** in the mode
  (**3 sections for Oonige**; section length is rounded down before multiplying).
- After exiting there is a **1 s cooldown**, then the 2 s interval resumes — **3 s total**.

**Pacemaker.** Non-front-runner modes are measured from the pacemaker. The selection mechanism is
only partly known: a range parameter of **10.0** and a count parameter of **2** are used.

**Distance thresholds** (non-front-runners hold a gap to the pacemaker between Min and Max):

```
CourseFactor = 0.0008 * (CourseLength - 1000) + 1.0

Pace Chaser : Min = 3.0 [m]        Max = 5.0 * CourseFactor [m]
Late Surger : Min = 6.5 * CourseFactor   Max = 7.0 * CourseFactor
End Closer  : Min = 7.5 * CourseFactor   Max = 8.0 * CourseFactor
```

### Mode table

| Mode | Target speed | Entry | Exit |
| --- | --- | --- | --- |
| **Speed Up** (front runner) | 1.04x | 1st place and < **4.5 m** (Oonige **17.5 m**) ahead of the uma behind; **12.5 m** if the only front runner. Wisdom check `20 * log10(Wiz*0.1) %` | > 4.5 m (Oonige 17.5 m) ahead of 2nd; **12.5 m** if exactly 1 front runner (excluding Oonige and rushed style changes) |
| **Overtake** (front runner) | 1.05x | not 1st within the same strategy; wisdom check `20 * log10(Wiz*0.1) %` | 10 m (Oonige **27.5 m**) ahead of 2nd within the same strategy |
| **Pace Up** (non-front) | 1.04x | distance from pacemaker above Max; wisdom check `15 * log10(Wiz*0.1) %` | distance below a random value between Min and Max |
| **Pace Down** (non-front) | **0.945x in mid-race**, else **0.915x** | distance from pacemaker below Min, and no target/current speed-up skill active | distance above a random value between Min and Max — **in mid-race the Max is replaced by `lerp(Min, Max, 0.5)` before rolling**. Also exits when a current/target speed-up skill applies. Debuffs do **not** remove it |
| **Pace Up Ex** | **2.0x** | front runner: another uma whose strategy should be behind is ahead · others: the pacemaker's strategy should be behind the uma | no other uma that should be behind is ahead |

Pace Up Ex is **prioritised over every other position-keep mode**.

### Rushed / Kakari 掛かり / Temptation

```
RushedChance = (6.5 / log10(0.1 * WizStat + 1))^2   [%]
```
The RNG is integer-based, so the chance is **effectively rounded up to the nearest integer
percent**. 300 Wiz → 19.00% · 600 → 13.26% → **14%** · 900 → 11.01% → **12%** ·
1200 → 9.74% → **10%**. The skill 自制心 reduces the chance by a flat **3%** (19% → 16%).

- Triggers in a random **section 2–9**, immediately upon entering that section.
- While rushed: HP consumption ×1.6, and the uma is forced into an aggressive position-keep
  strategy **and passes all position-keep wisdom rolls**. The strategy change only affects the AI
  — it does **not** change strategy coefficients used for base target speed.
  - Front Runners → speed up mode if a uma is close enough behind.
  - Pace Chasers → runners.
  - Late Surgers → 75% Front Runner, 25% Pace Chaser.
  - End Closers → 70% Front Runner, 20% Pace Chaser, 10% Late Surger.
- Every 3 s, **55%** chance to snap out. Rushed ends after **12 s** regardless.
- A debuff that worsens the rushed state **overwrites the timer to a fixed 5 s** with no exit rolls.

---

## 10. Spot Struggle 位置取り争い

Can trigger **once any uma has travelled 150 m**, between 2+ front runners or Oonige.

Conditions:

- One of the uma has not yet reached **section 6**.
- Close enough to the frontmost uma of their strategy: `DistanceGap < 3.75 m` and
  `LaneGap < 0.165 * courseWidth`.

Rules:

- May trigger **once per strategy**; front runners struggle among themselves, Oonige among
  themselves — a front runner never struggles with an Oonige.
- Cannot trigger if the frontmost uma of the strategy has been overtaken by a uma whose strategy
  *should be behind* (e.g. a Pace Chaser ahead of all front runners).
- All qualifying uma get, based on Guts:
  ```
  TargetSpeed += (500 * GutsStat)^0.6 * 0.0001                     [m/s]
  Duration     = (700 * GutsStat)^0.5 * 0.012 * StrategyProficiencyModifier  [s]
  ```
- Premature exit: more than **5.0 m** ahead or behind, or more than **0.416 course width**
  laterally.
- Always ends at **section 9**, even if the duration has not expired.
- HP consumption is multiplied (see the table in §6).

---

## 11. Compete Before Spurt 位置取り調整

`⚠️ inferred` — from the parameter file; under investigation.

Occurs between **sections 11–15**. Every 2 seconds a check runs; on success the uma enters
competition mode.

- Threshold distance from the lead (scales with course distance):
  Oonige **0.0** · Nige **0.0** · Senkou **2.5** · Sashi **5.0** · Oikomi **10.0**.
- Competition mode lasts **2 s** at the cost of stamina, then **1 s cooldown**.

```
TargetSpeedIncrease = ((Power/1500)^0.5 * 2.0 + (Guts/3000)^0.2) * 0.1 * StrategyCoefficient
```
Strategy coefficient: Oonige 0.2 · Nige 0.8 · Senkou 1.0 · Sashi 1.0 · Oikomi 1.0

```
StaminaConsumption = 20 * (StrategyCoefficient * DistanceCoefficient + NearFactor)
```
Stamina strategy coefficient: Oonige 1.5 · Nige 1.2 · Senkou 1.0 · Sashi 1.0 · Oikomi 1.0

Course-distance coefficient: <1401 m **0.3x** · <1801 m **0.3x** · <2101 m **0.5x** ·
<2201 m **0.8x** · <2401 m **1.0x** · <2601 m **1.1x** · ≥2601 m **1.2x**

`NearFactor` of **0.5** applies when the uma is *not* far from the lead — i.e. the mode fired
because of nearby uma alone. A front runner with no same-strategy uma within **10 m** has its
bonus further multiplied by Oonige **2.0** / Nige **1.1**.

### Stamina Keep 持久力温存

The uma tries to hold back a random amount of HP equal to **1.035–1.04x** the amount needed to
finish. Every 2 seconds it checks whether it has enough HP; if not, it notices and enters stamina
keep with chance `30% * (Wisdom / (1000 + Wisdom)^0.03)`. While in stamina keep it does **not**
join the competition. Activating an HP recovery skill **resets** the state, so competition can
re-activate if HP is now sufficient. (`⚠️ inferred` — the author notes packet testing gives
93/100 immediate activations at 1000 Wis, higher than this formula predicts.)

---

## 12. Secure Lead リード確保

`⚠️ inferred` — from the parameter file; under investigation.

Occurs between **sections 11–15** when the lead over a uma that *should* be further behind is less
than desirable. Every 2 seconds, if the lead is short, a **20%** chance (wisdom scaling unknown)
to attempt it.

```
DesirableLead = StrategyCoefficient + 0.0003 * (CourseDistance + 1000)   [m]
```
Strategy coefficient (row = the uma, column = the uma being led):

|  | Nige | Senkou | Sashi | Oikomi |
| --- | --- | --- | --- | --- |
| Oonige | 2.0 | 7.0 | 8.0 | 8.0 |
| Nige | — | 4.0 | 8.0 | 8.0 |
| Senkou | — | — | 5.0 | 6.0 |
| Sashi | — | — | — | 3.0 |

Lasts **2 s** at a stamina cost, then **1 s cooldown**.

```
TargetSpeedIncrease = (Guts/2000)^0.5 * 0.3 * StrategyCoefficient   [m/s]
```
Strategy coefficient: Oonige 0.2 · Nige 1.0 · Senkou 1.0 · Sashi 0.8

```
StaminaConsumption = 20 * StrategyCoefficient * CourseDistanceCoefficient
```
Stamina strategy coefficient: Oonige 1.2 · Nige 1.0 · Senkou 0.8 · Sashi 0.8
Course-distance coefficient: same bands as §11.

A Nige uma with no same-strategy uma within **10 m** gets its bonus multiplied by
Oonige **7.0** / Nige **2.0** — `⚠️ JP-only`: Nige becomes **4.0** after the JP 5th anniversary.

---

## 13. Charge Up / Fully Charged 足を貯める · Conserve Power / Release 脚色十分

The Power stat used here is:

```
PowerStat = BasePower + 0.5 * max(RawPower - 1200, 0) + SkillModifier
```
Past 1200, base and raw power are each halved, so the stat past 1200 is converted nearly 1:1.

The uma must have **more than 1200** power to conserve. Credit accrues over the **first 10
sections**:

```
ConservedPowerPerSecond = PositionKeepCoefficient * StyleCoefficient
```
Position keep coefficient: **4.2** in normal mode · **6.7** in pace down mode.
Style coefficient: Front Runner **1.0** · Pace Chaser **0.75** · Late Surger **1.0** ·
End Closer **0.7**

**Conserving stops** (and cannot restart for **1.5 s**) while in Speed Up, Overtake, Pace Up or
Pace Up Ex, while Rushed, or while in a Spot Struggle. Entering a Spot Struggle multiplies
current conserved power by **0.95**; entering Rushed multiplies it by **0.8**.

On entering the **last spurt**, if enough power was conserved, acceleration increases from the
next frame:

```
Accel = sqrt((PowerStat - 1200) * 130) * 0.001 * StrategyDistanceCoefficient * ActivityCoefficient
```
Strategy-distance coefficient:

| Strategy | Short | Mile | Mid | Long |
| --- | --- | --- | --- | --- |
| Front Runner | 1.0 | 1.0 | 1.0 | 1.0 |
| Pace Chaser | 0.7 | 0.8 | 0.9 | 0.9 |
| Late Surger | 0.75 | 0.7 | 0.875 | 1.0 |
| End Closer | 0.7 | 0.75 | 0.86 | 0.9 |

Activity coefficient starts at 1.0 and multiplies **0.98x** if the uma entered a Spot Struggle,
**0.8x** if it experienced Rushed.

```
Duration = ConservedPower * sqrt(CourseDistance) * DistanceTypeCoef / 1450
```
Distance type coefficient: Short **0.45** · Mile **1.0** · Mid **0.875** · Long **0.8**.
The release is **skipped** if the resulting duration is under **0.2 s**.

---

## 14. Dueling / Compete Fight 追い比べ

Happens on the **final straight**. A pair is a dueling candidate when:

- at least one has entered the final straight,
- `abs(DistanceGap) < 3.0 m`,
- `abs(LaneGap) < 0.25 course width`.

To actually trigger, the pair must stay valid for **2 seconds** and all of:

- both have ≥ **15%** HP,
- `abs(SpeedGap) < 0.6 m/s`,
- at least one is in the **top 50%** of the field,
- neither has already completed an earlier duel.

```
TargetSpeed += (200 * GutsStat)^0.708 * 0.0001   [m/s]
Accel       += (160 * GutsStat)^0.59  * 0.0001
```

A duel may involve more than 2 uma: a new uma joins by qualifying against any one active member.
Multiple duel groups can exist.

Exits when either:

- HP falls below **5%**, or
- the uma is more than **5 m** ahead of or behind every other member.

A uma that has exited can still keep others' duels alive, but cannot admit new members.

---

## 15. Start delay / late start

- At the start, a uma begins running after a random delay of up to **0.1 s**. **Wisdom does not
  affect this.**
- Delay > **0.08 s** ⇒ **late start**.
- Delay < **0.02 s** ⇒ start-dash score bonus in Team Stadium.

| Skill | Effect on start delay |
| --- | --- |
| アタシに指図しないで！！ | fixed at **0.085** |
| 超遊び癖 | fixed at **0.1** |
| Concentration コンセントレーション | ×**0.4** |
| Focus 集中力 | ×**0.9** |
| Gatekept ゲート難 | ×**1.5** |

- Delay **< 1 frame** (0.0666 s): acceleration and HP consumption are unaffected; distance
  travelled on the first frame is `SpeedAfterAccel * (1 frame − StartDelay)`.
- Delay **> 1 frame**: **no** acceleration, HP consumption or distance calculation happens. The
  lost acceleration is significant and can leave the uma blocked.
- A delay between 1 frame and 0.08 s produces **no late-start warning**.

---

## 16. Stamina Limit Break スタミナ勝負

`⚠️ inferred` — from the parameter file; under investigation.

If **base stamina + skill bonus > 1200**, the uma gains an extra target-speed buff on reaching max
spurt speed, lasting to the end of the race.

```
TargetSpeedBuff = sqrt(StaminaStat - 1200) * 0.0085 * DistanceFactor * RandomFactor   [m/s]
```

Distance factor: <2101 m → **0.0x** · <2201 m → **0.5x** · <2401 m → **1.0x** · <2601 m →
**1.5x** · ≥2601 m → **1.8x**

`⚠️ JP-only` — the two long-distance factors were **1.2x** and **1.5x** before the JP
2024-10-29 update; Global clients should be checked against the live values before relying on
the 1.5x/1.8x pair.

`RandomFactor` is not fully understood. The parameter file names
`TargetSpeedRandomTableChangeProbabilityByPower: 500` with:

| Table | Probability | Coefficient |
| --- | --- | --- |
| 0 | 50 | 0.98–1.00 |
| 1 | 30 | 0.95–0.98 |
| 2 | 20 | 1.00–1.02 |

---

## 17. Not on Global (JP-only)

These exist in the guide but are **not live on Global**. Listed so you recognise them in
JP-sourced material and don't plan around them.

| Mechanic | JP version | Notes |
| --- | --- | --- |
| **Stat clamp 2500** | 5th anniversary | Global clamps at 2000 (§0). Affects `MultiplySpeed` (22/23) bands, Zenkai Spurt and Wiz Limit Break thresholds. |
| **Zenkai Spurt 全開スパート** | 5th anniversary | With >2000 Speed and enough HP, on reaching target speed in the last spurt the uma keeps accelerating. Values under investigation; `Accel ≈ 0.068 * AccelFromPower / (CourseDistance/1000)^1.5 + SkillModifier`. Skills with **ID=48** interact with it but only at ~10% of their listed value. Acceleration is unaffected by normal accel skills or conserve-power/release. Running out of HP mid-zenkai drops speed straight to minimum (confirmed bug). |
| **Wiz Limit Break Buff** | 5th anniversary | With >1200 Wiz, **unique, evolved and gold** skills using target speed (ID=27) or current speed with natural deceleration (ID=22) get `BaseSkillValue * PhaseStrategyCoefficient * WizMultiplier`. Inherited and white skills are unaffected. WizMultiplier rises from **0.00 at +1** over 1200 to **1.11 at +1901** and **1.12 at +9999** (+0.02 per 20 to +201, then +0.06 per 20 to +401, then +0.01 per 20 to +801, then +0.01 per 100). Phase/strategy coefficient table (early / mid / late / last spurt): Front Runner **0.26/0.23/0.19/0.16**, Oonige same as Front Runner, Pace Chaser **0.21** across all four, Late Surger **0.19/0.18/0.23/0.24**, End Closer **0.15/0.17/0.25/0.27**. A skill that affects several uma uses the **activator's** Wiz. |
| **`MultiplyArcGlobalPotentialLevel` (24)** | L'arc scenario | §7. |
| **Nige secure-lead lone-wolf factor 4.0** | 5th anniversary | §12 (2.0 on Global). |
| **Stamina Limit Break long-distance factors 1.5x / 1.8x** | 2024-10-29 | §16. |

**Also not applicable:** the **Slope (Outdated)** course section — it was superseded by the 1st
anniversary track rewrite and is kept in the guide only for historical reference. Use
**Course Events** (§18) instead.

---

## 18. Race course geometry

Only relevant to simulator work: running on an outside lane while cornering, or running
diagonally, makes a uma **travel extra distance**.

- Each course has **1001 keyframes** (a 3D position + rotation quaternion) for 1000 equal-distance
  segments.
- Position at `Lane = 0` is lerped between keyframes; lane offset is applied perpendicular
  (left of rotation for clockwise courses, right for counter-clockwise) at **11.25 m per course
  width**:
  ```
  frame  = Distance / CourseDistance * 1000
  Pos_0  = lerp(Pos[floor(frame)], Pos[ceil(frame)], frame - floor(frame))
  Pos    = Pos_0 + CourseRotation × Rotation_0 × (11.25m * Lane)
  ```
- `ratio = Distance_world / Distance_course`; the base ratio (0 m → 1 m at lane origin) runs
  **0.96–1.06** across implemented courses. The base ratio uses 3D distance; per-frame ratios use
  horizontal distance.
  ```
  DistanceAdd_world = DistanceAdd_course / max(1, ratio_prev / ratio_base)
  ```
- Slope (historical): `SlopePer = tan(slopeAngle) * 100`; uphill if `SlopePer > 1.0`, downhill if
  `< −1.0` (i.e. more than 1 m altitude change per 100 m). **Outdated** — see §17.

### Course events

| ID | Name | Attribute | Notes |
| --- | --- | --- | --- |
| 0 | Corner | corner number (1–4); distance | |
| 1 | Ground Change | | turf → dirt |
| 2 | Straight | start/end; front type (front=1, across=2, false straight=3) | each straight = 2 events |
| 3 | Lane Max Change | new value | |
| 4 | First BGM Landscape | | legacy, purpose unknown |
| 5 | Second BGM Landscape | | |
| 6 | Jikkyo Trigger | | unused |
| 7 | Move Lane Point | | if absent, the entry point of the initial corner is used; only Niigata 1000 m defines it |
| 8 | First BGM | | |
| 9 | Second BGM | | |
| 10 | Event Crowd | | unused |
| 11 | Slope | SlopePer; length | |

---

## 19. Simulation order

**Race initialization**

1. (Before init) calculate base stats
2. Calculate skill activation chance and decide which skills can activate
3. Activate all out-of-gate skills
4. Use item (an unimplemented item could prevent late start)
5. Set starting location from gate number
6. Calculate start delay
7. Calculate adjusted stats
8. Convert stamina to HP
9. Set starting speed
10. Determine rushed

**Per frame** — each frame is split into steps; within a step, uma are updated in **gate-number
order**.

1. **Pre-update:** check end of corner
2. **Update:** activate skills → recover HP from skills → update last-spurt state → update target
   speed → calculate acceleration → update phase → calculate distance and position → check for slope
3. **Post-update**
4. **Events:** check start of corner

---

## 20. Quick decision rules

Useful one-liners for reasoning about a build or a track. All derived from the sections above.

- **Speed stat is dead weight until late-race.** Early/mid target speed is
  `BaseSpeed × phase coefficient` only; `SpeedStat` first appears in the late-race/last-spurt
  formula and in `LastSpurtSpeedMax`.
- **Power drives three things:** acceleration (`sqrt(500 × Power)`), lane-change speed
  (`0.02 × (0.3 + 0.001 × Power)`), and uphill speed loss (`SlopePer × 200 / Power`).
- **Guts drives four things:** minimum speed, the late-race HP-consumption penalty, last-spurt
  max speed, and Spot Struggle / Dueling bonuses.
- **Wit drives:** skill activation chance (base Wiz, `max(100 − 9000/Wiz, 20)%`), per-section
  target-speed randomness (`Wiz/5500 × log10(Wiz × 0.1)%`), Rushed chance, and the last-spurt
  candidate acceptance rate (`15 + 0.05 × Wiz`%).
- **Stamina → HP** at `0.8 × styleCoefficient × Stamina + distance`; the coefficients run from
  0.86 (Oonige) to 1.0 (Late Surger), with Pace Chaser at 0.89.
- **A uma out of HP is capped at minimum speed** — that is the failure mode a stamina check
  prevents, not a gradual slowdown.
- **Outside lanes and diagonal running cost distance** (§18) — relevant on corner-heavy tracks.
- **Front runners never enter Pace Down**, so they never get its 0.6x HP discount.
- **Position keeping only matters in sections 1–10**; after that, target speed is the base spurt
  logic.
- **A late start > 1 frame loses an entire frame of acceleration and distance** and can cause
  blocking — the single largest random swing at race start.

---

## Sources

- KuromiAK's guide, chapters [Concepts](./chapters/01-concepts.md) →
  [Short Mechanics](./chapters/15-short-mechanics.md) — the deep-dive source for every formula and
  constant here. Mechanics reverse-engineered by @umamusu_reveng, @kak_eng and @hoffe_33;
  simulators by Aya / kakku / Tunnelblick.
- Global scope (scenario list, stat caps) read from the Global client master data and the Global
  reference doc. See [the parenting quick-reference](../parenting-guide/README.md) for how
  this repo tracks Global vs JP.
- **This file is maintained by hand** — it is not generated by `split_guide.py`. If the guide is
  re-split or re-sourced, re-check the numbers here.
