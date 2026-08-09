# Race Mechanics Quick Reference

This document is a quick reference for the race mechanics that are available currently in the Global Server of Uma Musume: Pretty Derby.

## Core Race Mechanics ✅

### Stats & Speed

- ✅ Base/Adjusted/Final stats system with `1-2000` clamping
- ✅ Raw stats `>1200` halved before conversion to base stats
- ✅ Motivation coefficients [-4%, -2%, 0%, +2%, +4%]
- ✅ Strategy proficiency modifiers for Wit
- ✅ Ground modifiers (speed & power penalties)
- ✅ Race course threshold stat bonuses
- ✅ Base speed calculation: `20.0 - (distance - 2000) / 1000`
- ✅ Strategy phase coefficients for all 5 strategies (Front Runner, Pace Chaser, Late Surger, End Closer, Runaway)
- ✅ Distance/surface proficiency modifiers
- ✅ Section randomness (Wit-based)
- ✅ Minimum speed (Guts-based)
- ✅ Starting speed (`3 m/s`)
- ✅ Target speed hard cap (`30 m/s`)
- ✅ Force-in modifier (`Random(0.1) + StrategyModifier`, early-race, lane > `0.12 × courseWidth`, inside open)

### Last Spurt ✅

- ✅ **Guts component in max spurt speed**
  - Formula: `(BaseMidRaceTargetSpeed + 0.01 * BaseSpeedForDistance) * 1.05 + sqrt(500 * SpeedStat) * DistanceProficiencyModifier * 0.002 + (450 * GutsStat)^0.597 * 0.0001`
- ✅ Wit-based candidate selection (`15 + 0.05 * Wit %`)
- ✅ Recalculation on HP recovery after entering the late-race
- ✅ 60m buffer zone estimation
- ✅ Does NOT recalculate on debuffs

### Acceleration & Deceleration

- ✅ Base acceleration (`0.0006` normal, `0.0004` uphill)
- ✅ Strategy phase coefficients (Front Runner, Pace Chaser, Late Surger, End Closer, Runaway)
- ✅ Start dash (`+24 m/s²`)
- ✅ Start dash bug fixes (speed cap, speed debuff handling)
- ✅ Phase deceleration (`-1.2`/`-0.8`/`-1.0`)
- ✅ **Pace Down deceleration override** (`-0.5 m/s²` during Pace Down; Out-of-HP still overrides)

### HP/Stamina System ✅

- ✅ Strategy coefficients for max HP
- ✅ HP consumption formula with status/ground modifiers
- ✅ Late-race guts modifier (`1.0 + 200/sqrt(600 * GutsStat)`)
- ✅ HP recovery skills (percentage of max HP)
- ✅ Out of HP → minimum speed

## Skill System ✅

### Activation & Duration

- ✅ Wit-based activation chance: `max(100 - 9000/BaseWitStat, 20)%`
- ✅ Uses **base `Wit`** (not affected by `Wit` proficiency/skills)
- ✅ Course distance scaling for duration/cooldown
- ✅ Skill level multipliers (`1.0x` to `1.25x` for `SpeedStat`)
- ✅ Green skills bypass Wit check
- ✅ Unique rarity skills bypass Wit check

### Skill Conditions

- ✅ `x_random` (10m segment selection)
- ✅ `straight_random`, `corner_random`, `all_corner_random`
- ✅ `phase_corner_random`
- ✅ `phase` (checked before phase update)
- ✅ `remain_distance` (floor-based, can trigger at `398.000001` for `≥399`)
- ✅ `order_rate` conversion with rounding
- ✅ `order_rate_inXX_continue` (first 5s don't count)
- ✅ `near_count` (`3m` distance, `3` horse lanes) - **1st anniversary values**
- ✅ `is_surrounded`
- ✅ `behind_near_lane_time`, `infront_near_lane_time`
- ✅ `activate_count_x` (ID order matters)

### Skill Types & Effects

- ✅ `Green` skills (stat bonuses)
- ✅ `ChangeStrategy` (`6`): Runaway always activates and promotes the position-keep strategy to `Runaway`
- ✅ `RushedDuration` (`13`): Frenzied family extends a rushed matching-style opponent's timer by +5s
- ✅ `TargetSpeed`, `CurrentSpeed`, `Acceleration`
- ✅ `CurrentSpeed` instant speed change
- ✅ `CurrentSpeedWithNaturalDeceleration` (natural deceleration)
- ✅ `LaneMovementSpeed` (lane movement speed)
- ✅ `Recovery` skills (HP recovery)
- ✅ `StartDelay` modifiers
- ❌ Activate random gold skills - Not in Global yet
- ❌ Evolution skill duration scaling - Not in Global yet

### Value Scaling Types

- ✅ `Direct` (1)
- ❌ `MultiplySkillNum` (2)
- ✅ `Aoharu` skills (3-7) — team-stat tiers apply in TT/CM; extract pre-applies the best tier (1.2×), so the sim assumes a ≥3600-total team
- ✅ `MultiplyRandom` (8, 9)
- ❌ `Climax` skills (10)
- ❌ `MultiplyMaximumRawStatus` (13)
- ✅ `MultiplyActivateSpecificTagSkillCount` (14) — counts activated green (601–615) skills: `0–2 → 0×`, `3–4 → 1×`, `5 → 2×`, `6+ → 3×`
- ❌ `AddDistanceDiffTop` (19)
- ❌ `MultiplyBlockedSideMaxContinueTime` (20)
- ❌ `MultiplySpeed` (22, 23)
- ❌ `MultiplyArcGlobalPotentialLevel` (24) - Not in Global yet
- ❌ `MultiplyTopLeadAmount` (25) - Not in Global yet

### Duration Scaling Types

- ✅ `Direct` (1)
- ✅ `MultiplyDistanceDiffTop` (2)
- ✅ `MultiplyRemainHp` (3, 7)
- ✅ `IncrementOrderUp` (4)
- ✅ `MultiplyBlockedSideMaxContinueTime` (5)

### Additional Activate

- ✅ `OrderUp` (1) - up to 3 overtakes
- ✅ `AdditionalActivateActivateAnySkill` (2, 3) - up to 2-3 times

## Lane Movement ✅

- ✅ Lane measurement (`CourseWidth` units, horse lanes)
- ✅ Initial lane by `GateNumber`
- ✅ Lane change speed (`PowerStat`-based, with acceleration)
- ✅ Target lane strategies: `Normal`, `Overtake`, `Fixed`
- ✅ Overtake targets (`1-20m` ahead, catchable in `15s`)
- ✅ **Extra move lane (`FinalCorner`)** - 1st anniversary change
  - Previously activated on final straight
- ✅ Front/side `Blocking`
- ✅ `Overlapping` (`0.4m` bump)
- ✅ `VisionCone` (`20m` default, `11.5` horse lane width)

## Position Keeping ✅

- ✅ Sections `1-10` only
- ✅ `2`-second check interval, `1` section duration
  - ✅ `Runaway` uses `3` sections (distance uses `floor(sectionLength)` before multiply)
- ✅ `3`-second cooldown after exit
- ✅ `Wit`-based entry checks
- ❌ **Pacemaker selection** (post-1.5 anniversary algorithm)
  - `Range=10.0`, `Count=2.0` parameters

### Front Runner Modes

- ✅ `SpeedUp` (`1.04x`) - `4.5m`/`17.5m` thresholds (`12.5m` if solo)
- ✅ `Overtake` (`1.05x`) - within same strategy

### Non-Front Runner Modes

- ✅ `PaceUp` (`1.04x`)
- ✅ `PaceDown` (`0.945x` mid-race, `0.915x` otherwise)
  - ✅ Mid-race exit-distance roll caps max at `lerp(Min, Max, 0.5)`
- ✅ **Pace Up Ex (`2.0x`)** - 1.5-anniversary position-keep override

## Special States & Competition ✅

### Rushed ✅

- ✅ Pre-race `Wit` roll: `(6.5/log10(0.1*Wit+1))²%`
- ✅ Restraint skill: `-3%` flat (ID 202161), modeled via effect type 29 (`RushedChance`)
- ✅ Random section `2-9` activation
- ✅ `1.6x` HP consumption modifier
- ✅ Forces position keep mode, auto-passes `Wit` checks
- ✅ `55%` escape chance every `3s`, max `12s`
- ✅ Debuff worsening extends `+5s` modifier

### Spot Struggle ✅

Real-data amendments from [hakuraku.moe/notes/spot-struggle](https://hakuraku.moe/notes/spot-struggle):

- ✅ Sections `1-6` (150m to section 6 end); the 150m unlock is **field-global** (any uma passing 150m unlocks it for everyone); only one grouped uma needs to still be within section 6
- ✅ 2+ `FrontRunner` or 2+ `Runaway` required (styles never mix); each style triggers **once per race**
- ✅ Entry (both styles — Oonige is NOT wider): <3.75m behind the **frontmost** uma of the style, <0.165 course width laterally; everyone in range of the frontmost enters together
- ✅ Speed boost: `(500*GutsStat)^0.6 * 0.0001` m/s
- ✅ Duration: `(700*GutsStat)^0.5 * 0.012` s **× strategy proficiency modifier** (S 1.1, A 1.0, B 0.85, C 0.75, D 0.6, E 0.4, F 0.2, G 0.1); always ends at section 9
- ✅ Early exit: ≥5.0m behind ALL other active strugglers of the style, or ≥0.416 course width laterally from all (`DistanceGap2`/`LaneGap2` are exit constants, not Oonige entry); when all others distance-exited, the last struggler exits too (natural expiry does not cascade)
- ✅ HP consumption multipliers:
  - `FrontRunner`: `1.4x` (3.6x if rushed)
  - `Runaway`: `3.5x` (7.7x if rushed)

### Dueling ✅

Real-data amendments from [hakuraku.moe/notes/dueling](https://hakuraku.moe/notes/dueling):

- ✅ `FinalStraight` only; no strategy exclusion (front runners can duel)
- ✅ 2+ Uma within `3.0m`, `0.25` course width for `2s` — the 2s window applies to **proximity only**; during the window only the **target** must be on the final straight (initiator checked at trigger frame)
- ✅ Trigger-frame checks (single frame after the window): both ≥15% HP, speed gap `<0.6 m/s`, at least **one** of the pair in the top 50% (that uma is the target)
- ✅ Speed: `(200*GutsStat)^0.708 * 0.0001` m/s
- ✅ Accel: `(160*GutsStat)^0.59 * 0.0001` m/s²
- ✅ Exits: `<5%` HP, or ≥5m (ahead OR behind) from every current-or-former duel participant
- ✅ Former participants cannot re-enter or be new targets, but still count for keeping nearby duels alive

### Downhill Mode ✅

- ✅ `Wit` \* `0.04%` chance per second to enter
- ✅ `20%` chance per second to exit
- ✅ Speed boost: `0.3 + slopePer/10` m/s
- ✅ HP consumption: 0.4x (60% reduction)

### Start Delay ✅

- ✅ Random `0-0.1s` (not affected by `Wit`)
- ✅ Late start: `>0.08s`
- ✅ Fast start: `<0.02s` (only on Team Trials mode)
- ✅ Skill modifiers (`Concentration: 0.4x`, `Focus: 0.9x`, `Gatekept: 1.5x`)
- ✅ Fixed delays for `You're Not the Boss of Me!` (`0.085s`, ID 202141) and `Feelin' a Bit Silly` (`0.1s`, ID 1100011) via `SetStartDelay`

### Power Conservation / Fully Charged ✅

> Added in Global's 2026-07-01 update.

- ✅ **Conserve Power / Fully Charged** (足を貯める / 脚色十分)
  - ✅ Power >1200 required
  - ✅ Last-spurt acceleration boost
  - ✅ Strategy-distance coefficients
  - ✅ Race Mechanics panel shows frequency + mean accel (`X% (+Y m/s²)`)
  - ⚠️ Assumptions pending firmer research: fully-charged threshold = `100.0`, duration = `3.0s × distance-type coefficient`, skill-ability decay interaction ignored

## NOT Yet Available in TorenaSim

### Global 7/1 Update (Deferred / Research Needed)

- ❌ Post-1.5 pacemaker selection algorithm (`Range=10.0`, `Count=2.0` hints only)

### JP 2.5th Anniversary Update - Not in Global

- ❌ **Compete Before Spurt** (位置取り調整)
  - Sections 11-15
  - Distance-based triggering
  - Stamina cost calculations
- ❌ **Stamina Keep** (持久力温存)
  - HP conservation mode
  - Wisdom-based awareness
- ❌ **Secure Lead** (リード確保)
  - Sections 11-15
  - Strategy-based thresholds
  - 20% activation chance
- ❌ **Stamina Limit Break** (スタミナ勝負)
  - Stamina >1200 required
  - Distance factors (2101m+)
  - Random table coefficients
  - Updated coefficients (2024-10-29)

### Skills not in Global

- ❌ L'arc Global Potential (scenario-specific)

## Course & World ✅

- ✅ 1001 keyframes (1000 segments)
- ✅ 3D position + rotation quaternion
- ✅ Distance ratio calculation
- ✅ Outside lane increases travel distance
- ✅ 11 course event types
- ✅ Slope detection (>1.0% grade)
- ✅ Course width: 11.25m
- ✅ Horse lane: `1/18` course width = `0.625m`
- ✅ Max lane: varies by course (`1.1` to `1.5` course width)

## Misc Details ✅

- ✅ Frame rate: 0.0666s (15 FPS)
- ✅ 24 sections per race
- ✅ 4 phases [EarlyRace: 0, MidRace: 1, LateRace: 2, LastSpurt: 3]
- ✅ 1 Bashin = `2.5m`
- ✅ Display time: `actualTime * 1.18`
- ✅ Position recording: `1s` intervals (or every frame `<1s` or `<25m` from goal)
- ✅ Skills activate in ID order
- ✅ Target speed cap: `30 m/s`
