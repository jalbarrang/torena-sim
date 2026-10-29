# Speed

## Target Speed

Target speed is the speed a uma will trend towards. When below the target speed, a uma will accelerate. When above the target speed, a uma will decelerate. Target speed cannot go below [minimum speed](./03-speed.md#minimum-speed) or exceed 30 m/s.
$TargetSpeed=(BaseTargetSpeed|LastSpurtSpeed)*PositionKeepCoef+$
$ForceInModifier+SkillModifier+SlopeModifier+MoveLaneModifier$

Position keeping coefficient is covered in [its own section](./08-position-keeping.md#position-keeping).

Force-in modifier is applied in the early-race when an uma is more than 0.12 course width away from the inner fence and inside is blocked. The random number is rolled once at race start.
$ForceInModifier=Random(0.1)+StrategyModifier[m/s]$
Strategy modifier is

- Front Runner 0.02m/s
- Pace Chaser 0.01m/s
- Late Surger 0.01m/s
- End Closer 0.03m/s

Move lane modifier is applied when an uma is affected by a skill that modifies lane move speed, and has performed lane movement in the previous frame. Note that this was added after the 1st anniversary.
$MoveLaneModifier=(0.0002*PowerStat{)}^{0.5}[m/s]$

### Slope Modifier

Slope modifier is applied when a uma is running on uphill or downhill, see [Course Events](./14-race-courses.md#course-events).

When running uphill, a uma loses target speed equal to $SlopePer*200/PowerStat$. When running downhill, every second there is a chance of $WizStat*0.04%$ to enter downhill accel mode that increases target speed by $0.3+abs(SlopePer)/10\ [m/s]$ and reduces HP consumption by 60%. Each second the downhill accel mode has a 20% chance to end.

## Base Speed

A race’s base speed is determined by race course distance.
$BaseSpeed=20.0-(CourseDistance-2000m)/1000[m/s]$
Examples:

- 1200m races have a base speed of 20.8m/s
- 2000m races have a base speed of 20.0m/s
- 2500m races have a base speed of 19.5m/s

## Base Target Speed

The formula for base target speed varies depending on [phase](./01-concepts.md#phase).
During early-race and mid-race,
$BaseTargetSpeed=BaseSpeed*StrategyPhaseCoef$
Worth noting that target speed is NOT affected by speed stat in early-race and mid-race.

During late-race and last spurt,
$BaseTargetSpeed=BaseSpeed*StrategyPhaseCoef+$$sqrt(500*SpeedStat)*DistanceProficiencyModifier*0.002[m/s]$

### Strategy Phase Coefficient

| Strategy | Early-race | Mid-race | Late-race & Last Spurt |
| :---- | :---- | :---- | :---- |
| Front Runner | 1.0 | 0.98 | 0.962 |
| Pace Chaser | 0.978 | 0.991 | 0.975 |
| Late Surger | 0.938 | 0.998 | 0.994 |
| End Closer | 0.931 | 1.0 | 1.0 |
| Oonige | 1.063 | 0.962 | 0.95 |

### Distance Proficiency Modifier

| S | A | B | C | D | E | F | G |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.6 | 0.4 | 0.2 | 0.1 |

### Randomness Per Section

At each [section](./01-concepts.md#section), [race base speed](./03-speed.md#base-speed) multiplied by a random number is added to target speed. The random number is affected by wisdom stat. This randomness does not affect the speed during the last spurt.
$Max=WizStat/5500*lo{g}_{10}(WizStat*0.1)[%]$
$Min=WizStat/5500*lo{g}_{10}(WizStat*0.1)-0.65[%]$
Examples:

- 400 Wiz, Max=+0.117%, Min=-0.533%
- 800 Wiz, Max=+0.277%, Min=-0.373%

## Last Spurt

Last spurt distance and target speed are calculated at the beginning of the late-race (without randomness per section). The concept of last spurt is not to be confused with the [last spurt phase](./01-concepts.md#phase).
$LastSpurtSpee{d}_{Max}=(BaseTargetSpee{d}_{Phase2}+0.01*BaseSpeed)*1.05+$
$sqrt(500*SpeedStat)*DistanceProficiencyModifier*0.002+$
$(450*GutsStat{)}^{0.597}*0.0001[m/s]$
Note that the guts component was added after the 1st anniversary.

Upon entering the late-race, if the uma has enough HP to run the remaining distance at max target speed, she will immediately start the last spurt using the max target speed.

If HP is insufficient, a list of last spurt speed and distance candidates are calculated by lowering the target speed by 0.1m/s each step, till the last spurt speed reaches base target speed of the late-race. Then candidates are sorted by the time it would take to finish the race (sum of respective distance divided by speed, ignoring acceleration). Going from best to worst time, each candidate has a chance of $15+0.05*WizStat[%]$ chance to be accepted. If all candidates are exhausted without passing the wisdom check, the slowest candidate is chosen.

Last spurt calculation estimates the stamina usage up to 60m before the goal line. The calculation does not take into account the time it takes to accelerate to target speed. If an HP recovery skill activates after entering the late-race, the last spurt speed and distance are re-calculated. Debuffs on the other hand do not trigger a re-calculation. Note that the recalculation was added after the 1st anniversary.

## Starting Speed

The speed at race start is 3m/s.

## Minimum Speed

A uma’s minimum speed is affected by her guts.
$MinSpeed=0.85*BaseSpeed+sqrt(200.0*GutsStat)*0.001[m/s]$

Minimum speed is the target speed when a uma is out of HP.

Minimum speed comes into effect after the [start dash](./04-acceleration.md#start-dash). After each frame’s acceleration calculation, if a uma has less than minimum speed, her speed is instantly raised to match the minimum speed.

## Blocking

When blocked, a uma’s speed is capped between 0.988x(at 0m) to 1.0x(at 2m) of the speed of the uma in front, scaled linearly to the distance in between.

## Current Speed

Speed debuffs affect actual speed (or distance covered, in a sense) after all other calculations. The change in speed is instant with no need for acceleration / deceleration.

---

*[← Stats](./02-stats.md) · [Contents](../README.md) · [Acceleration →](./04-acceleration.md)*
