# Special Skill Activation Conditions and Effects

English translation of the Japanese article at:
<https://umamusumeschool.com/skill_special_conditions/#toc6>

## Notes

- This is a translation/adaptation of the source article, not a full re-validation against the latest reverse-engineering notes.
- The original article assumes **9-runner Champion's Meeting races**.
- I kept skill names in Japanese where an official Global name was not obvious, and translated the mechanics around them.
- I cross-checked the translation against `docs/simulation-learnings/quick-reference.md` and `docs/simulation-learnings/race-mechanics.md`.
- Where the source appears older or more heuristic than the current simulator docs, I call that out explicitly.

## Table of Contents

1. [Unique skills](#unique-skills)
   1. [麗しき花信風 (Mejiro Bright)](#麗しき花信風-mejiro-bright)
   2. [きらめくは海、まばゆきは君 (Swimsuit Mejiro McQueen)](#きらめくは海まばゆきは君-swimsuit-mejiro-mcqueen)
2. [Speed skills](#speed-skills)
   1. [Uma Stan / Super Stan](#uma-stan--super-stan)
   2. [Risky Business / Nothing Ventured](#risky-business--nothing-ventured)
3. [Acceleration skills](#acceleration-skills)
   1. [Nimble Navigator / No Stopping Me!](#nimble-navigator--no-stopping-me)
4. [Debuff skills](#debuff-skills)
   1. [Sharp Gaze / All-Seeing Eyes](#sharp-gaze--all-seeing-eyes)
   2. [Frenzied {strategy}](#frenzied-strategy)
5. [Lane-change skills](#lane-change-skills)
   1. [Dodging Danger / Sixth Sense](#dodging-danger--sixth-sense)
6. [Scenario skills](#scenario-skills)
   1. [Unity Cup](#unity-cup)
   2. [Trackblazer: Start of the Climax](#trackblazer)
   3. [Grand live](#grand-live)

## Unique skills

### 麗しき花信風 (Mejiro Bright)

- **Activation conditions:** 4th-7th place and in the latter half of the race
- **Effect magnitude:** `0.15 [m/s] × unique-skill level modifier`
- **Base duration:** `5 [s]`
- **Hidden effect:** duration is extended based on current HP

| Remaining HP   | Duration multiplier |
| -------------- | ------------------: |
| Less than 2000 |                ×1.0 |
| 2000-2399      |                ×1.5 |
| 2400-2599      |                ×2.0 |
| 2600-2799      |                ×2.2 |
| 2800-2999      |                ×2.5 |
| 3000-3199      |                ×3.0 |
| 3200-3499      |                ×3.5 |
| 3500 or more   |                ×4.0 |

HP is calculated as:

```text
HP = 0.8 × strategy coefficient × (stamina stat × motivation coefficient + green-skill bonus) + course distance
```

Because of that, this unique generally lasts longer in longer races. For a fuller HP explanation, see the original linked article chain or this repo's `docs/simulation-learnings/race-mechanics.md`.

The HP value checked is the HP **at the activation point**. So when using Mejiro Bright, stacking more recovery skills that activate in the first half of the race can lengthen this unique further.

### きらめくは海、まばゆきは君 (Swimsuit Mejiro McQueen)

- **Activation conditions:** 1st-4th place and in the latter half of the race
- **Effect magnitude:** `0.15 [m/s] × unique-skill level modifier`
- **Base duration:** `5 [s]`
- **Hidden effect:** duration is extended based on current HP

| Remaining HP   | Duration multiplier |
| -------------- | ------------------: |
| Less than 2000 |                ×1.0 |
| 2000-2399      |                ×1.5 |
| 2400-2599      |                ×2.0 |
| 2600-2799      |                ×2.2 |
| 2800-2999      |                ×2.5 |
| 3000-3199      |                ×3.0 |
| 3200-3499      |                ×3.5 |
| 3500 or more   |                ×4.0 |

HP depends on strategy, distance, and stamina. Because Front Runner and Pace Chaser have lower HP coefficients than Late Surger and End Closer, the stamina and recovery-skill requirements here are higher than for Mejiro Bright.

## Speed skills

### Uma Stan / Super Stan

- **Activation conditions:** 3 or more other runners are nearby, and at least 5 seconds have passed since the start
- **Effect magnitude:** `0.15 [m/s]` (`0.35 [m/s]`)
- **Duration:** `3 [s]`

The source article explains "3 or more runners are nearby" as at least 3 runners within a circle of radius `1.5 m` centered on your runner.

> **Cross-check note:** our current `docs/simulation-learnings/race-mechanics.md` defines `near_count` using the post-1st-anniversary values: `abs(DistanceGap) < 3m` and `abs(LaneGap) < 3HorseLane`. So treat the article's `1.5 m` circle explanation as a historical or simplified visualization rather than the current canonical simulator definition.

The original article includes a diagram that simplifies this into 8 nearby zones around the runner. Practically speaking, you can think of it as: if at least 3 runners are occupying those nearby zones, the skill can activate.

If you are running on the innermost side, some of those nearby zones are effectively blocked by the rail, so activation becomes harder. If you are in the lead, there are no runners in front of you, so activation also becomes harder.

For Front Runners in particular, if the start dash succeeds from the inside, many of the nearby zones become unavailable. Whether this skill is worth taking depends a lot on how many Front Runners you expect in the field.

### Risky Business / Nothing Ventured

- **Activation conditions:** random point in the back half of the race
- **Effect magnitude:** `0.25 [m/s]` (`0.45 [m/s]`)
- **Duration:** `1.8 [s]`
- **Hidden effect:** consumes HP
  - 60% chance: `0%` HP consumed
  - 30% chance: `2%` HP consumed
  - 10% chance: `4%` HP consumed

Considering that a white recovery restores `1.5%` HP and a gold recovery restores `5.5%` HP, this drawback is quite large.

It also does **not** count toward conditions that care about recovery-skill activations, such as skills that specifically require a recovery skill to have triggered.

## Acceleration skills

### Nimble Navigator / No Stopping Me!

- **Activation conditions:** in last-spurt state, blocked in front for at least 1 second, and at least `1%` HP remaining
- **Effect magnitude:**
  - acceleration: `0.2 [m/s²]` (`0.4 [m/s²]`)
  - lateral movement speed: `0.005 [m/s]` (`0.025 [m/s]`)
- **Duration:** `3 [s]`

"Blocked in front for at least 1 second" means the same runner has stayed in one of the forward blocking positions for at least 1 second.

That 1-second timer is already counted from mid-race. So if you stay tucked behind the runner ahead and enter the endgame while already satisfying the timer, this skill can trigger at the earliest possible moment when last spurt begins.

## Debuff skills

### Sharp Gaze / All-Seeing Eyes

- **Activation conditions:** 6th-9th place, random point in the first half of endgame, strategy = Late Surger
- **Effect magnitude:** drains `1%` (`3%`) HP from affected targets
- **Hidden effect:** only works on targets inside the user's vision range

The article notes that the vision limitation comes from player testing; the exact range was unclear from data analysis alone.

Default vision range is `20 m`.

- `差しのコツ○` adds `+5 m`
- `差しのコツ◎` adds `+10 m`

### Frenzied {strategy} {#frenzied-strategy}

- **Activation conditions:** a runner using strategy `Front Runner / Pace Chaser / Late Surger / End Closer` is in the Rushed/Kakari state, and you yourself are **not** in that state
- **Effect:** causes the target to enter the Rushed/Kakari state for `5 [s]`

The target remains in that state for a fixed 5 seconds regardless of the usual end conditions for Kakari.

If multiple runners activate it at exactly the same time, the duration is still fixed at 5 seconds. If they activate at different times, the target stays Rushed/Kakari for 5 seconds starting from the **latest** activation.

## Lane-change skills

### Dodging Danger / Sixth Sense

- **Activation conditions:** early-race, blocked in front or on the side for at least 1 second, strategy = Front Runner
- **Effect magnitude:** lateral movement speed `0.025 [m/s]` (`0.035 [m/s]`)
- **Duration:** `3 [s]`
- **Hidden effect:** moves the runner to lane 9

Here, lane 9 means the outermost lane in a 9-runner race.

When this activates, the runner swings outward a lot. But because lane-change skills effectively gain speed while lane movement is happening, it can function like a speed skill in practice.

That said, you still need to be careful about the extra distance lost when moving back inward afterward.

It has good synergy with **Prudent Positioning**, another early-race lateral-movement-speed skill. Its gold counterpart in local data is **Center Stage**. If they line up well, the runner can make a large move forward.

## Scenario skills

### Unity Cup {#unity-cup}

- **Hidden effect:** effect magnitude is scaled by the team's total `stat × motivation coefficient`
- **Duration does not increase**

In current repo terminology, this corresponds to scaling by the team's total **base stats**, matching the `Aoharu Skills (3-7)` section in `docs/simulation-learnings/race-mechanics.md`.

| Team total     | Effect multiplier |
| -------------- | ----------------: |
| Less than 1200 |              ×0.8 |
| Less than 1800 |              ×0.9 |
| Less than 2600 |              ×1.0 |
| Less than 3600 |              ×1.1 |
| 3600 or more   |              ×1.2 |

### Trackblazer: Start of the Climax {#trackblazer}

- **Hidden effect:** effect magnitude is scaled by the number of races won
- **Duration does not increase**

| Wins          | Effect multiplier |
| ------------- | ----------------: |
| Fewer than 6  |              ×0.8 |
| Fewer than 14 |              ×0.9 |
| Fewer than 18 |              ×1.0 |
| Fewer than 25 |              ×1.1 |
| 25 or more    |              ×1.2 |

### Grand live {#grand-live}

- **Hidden effect:** effect magnitude is scaled by fan count
- **Duration does not increase**

| Fan count          | Effect multiplier |
| ------------------ | ----------------: |
| Fewer than 20,000  |              ×0.8 |
| Fewer than 50,000  |              ×0.9 |
| Fewer than 100,000 |              ×1.0 |
| Fewer than 160,000 |              ×1.1 |
| 160,000 or more    |              ×1.2 |

## Cross-check summary against local docs

- **Mejiro Bright / Swimsuit Mejiro McQueen:** the remaining-HP duration table matches `MultiplyRemainHp (3)` in `docs/simulation-learnings/race-mechanics.md`.
- **Aoharu scenario skills:** the effect table matches the `Aoharu Skills (3-7)` scaling used in the simulator docs.
- **Risky Business / Nothing Ventured:** the `60% / 30% / 10%` drawback split is consistent with the generic `Multiply Random (8, 9)` table in the simulator mechanics reference.
- **Sharp Gaze / All-Seeing Eyes:** the source article's note about vision-limited targeting aligns with the simulator doc's default `20m` vision model.
- **Nimble Navigator / No Stopping Me!:** the article's last-spurt blocked-in-front trigger description matches the corresponding local skill pair.
- **Dodging Danger / Sixth Sense:** the practical "acts like a speed skill while moving lanes" explanation is consistent with lane-movement mechanics and `MoveLaneModifier` behavior.
- **Prudent Positioning:** its gold counterpart is **Center Stage**.
- **Main discrepancy:** the article's explanation for **Uma Stan / Super Stan** uses a `1.5m` proximity picture, while our current local mechanics doc defines `near_count` with `3m` distance and `3HorseLane` width.

## Translator notes for this repo

To keep terminology aligned with the simulator docs, this translation uses:

- **HP** for `体力`
- **Strategy** for `脚質 / 作戦` where it refers to race style
- **Front Runner / Pace Chaser / Late Surger / End Closer** for `逃げ / 先行 / 差し / 追込`
- **Last spurt** for `ラストスパート`
- **Lane** / **lateral movement** for `レーン` movement concepts
- **Rushed/Kakari state** for `掛かり`
