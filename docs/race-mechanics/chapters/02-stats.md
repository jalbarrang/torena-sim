# Stats

Each stat is clamped between 1 and 2000. This and all subsequent stat caps were raised to 2500 on the 5th anniversary.
$FinalStat=AdjustedStat+SkillModifier$
The final stat is the stat referred to in formulas, unless otherwise specified.

## Raw Stats

Raw stats are the stats shown in the stat panel.
Raw stats past 1200 are halved before being converted to base stats.

## Base Stats

Base stats are raw stats modified by motivation. This number is used sometimes instead of the final stat, most notably by [skill activation chance](./06-skills.md#skill-activation-chance).
Base stat is also [subject to clamping](./02-stats.md#stats).
$BaseStat=(RawStats+AoharuTeamRankBonus)*MotivationCoef$

### Motivation Coefficient

| 絶好調 | 好調 | 普通 | 不調 | 絶不調 |
| :---- | :---- | :---- | :---- | :---- |
| 1.04 | 1.02 | 1.0 | 0.98 | 0.96 |

## Adjusted Stats

Each adjusted stat is also [subject to clamping](./02-stats.md#stats).
$AdjustedSpeed=BaseSpeed*RaceCourseModifier+GroundModifier+SingleModeModifier$
$AdjustedStamina=BaseStamina+SingleModeModifier$
$AdjustedPower=BasePower+GroundModifier+SingleModeModifier$
$AdjustedGuts=BaseGuts+SingleModeModifier$
$AdjustedWiz=BaseWiz*StrategyProficiencyModifier+SingleModeModifier$

### Ground Modifier

Ground modifier for speed

|  | 良 Firm | 稍重 Good | 重 Soft | 不良 Heavy |
| :---- | :---- | :---- | :---- | :---- |
| Turf | 0 | 0 | 0 | -50 |
| Dirt | 0 | 0 | 0 | -50 |

Ground modifier for power

|  | 良 Firm | 稍重 Good | 重 Soft | 不良 Heavy |
| :---- | :---- | :---- | :---- | :---- |
| Turf | 0 | -50 | -50 | -50 |
| Dirt | -100 | -50 | -100 | -100 |

### Strategy Proficiency Modifier

| S | A | B | C | D | E | F | G |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1.1 | 1.0 | 0.85 | 0.75 | 0.6 | 0.4 | 0.2 | 0.1 |

### Race Course Modifier

Some race courses have 1-2 stats as threshold stats. Having [base stat](./02-stats.md#base-stats) that exceeds threshold provides a bonus to adjusted speed.

- Stat \<= 300, +0.05x
- 300 \< Stat \<= 600, +0.1x
- 600 \< Stat \<= 900, +0.15x
- 900 \< Stat, +0.2x

The final modifier is the average of modifiers for all threshold stats. Therefore the maximum bonus achievable is +0.2x.

### Single Mode Modifier

In single mode (a.k.a. training), all uma gain 400 adjusted stats.

---

*[← Concepts](./01-concepts.md) · [Contents](../README.md) · [Speed →](./03-speed.md)*
