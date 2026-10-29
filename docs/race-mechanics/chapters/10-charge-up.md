# Charge Up / Fully Charged | Conserve Power / Release 足を貯める / 脚色十分

For this mechanic, the power stat used is
$PowerStat=BasePower+0.5*max(RawPower-1200,0)+SkillModifier{\ }$
(Both base power and the raw power term are halved past 1200. Adding them up means the stat past 1200 is almost converted 1:1. But there is a subtle difference in how motivation interacts with the resulting stat.)

The uma must have more than 1200 power stat to conserve power.

For the first 10 sections of the course, a uma earns credit towards her conserved power.

Each second, the uma gains conserved power
$ConservedPowerPerSecond=PositionKeepCoefficient*StyleCoefficient$

Position keep coefficient is

- 4.2 when in position keep [normal mode](./08-position-keeping.md#normal-mode)
- 6.7 when in position keep [pace down mode](./08-position-keeping.md#pace-down-mode)

Style coefficient is

| Front Runner | Pace Chaser | Late Surger | End Closer |
| :---- | :---- | :---- | :---- |
| 1.0 | 0.75 | 1.0 | 0.7 |

The following conditions prevent power from being conserved:

- Position keep mode is one of [Speed Up](./08-position-keeping.md#speed-up-mode), [Overtake](./08-position-keeping.md#overtake-mode), [Pace Up](./08-position-keeping.md#pace-up-mode), or [Pace Up Ex](./08-position-keeping.md#pace-up-ex-mode)
- [Rushed](./08-position-keeping.md#rushed-kakari-掛かり-temptation)
- [Spot Struggle](./09-spot-struggle.md#spot-struggle--lead-competition-位置取り争い)

These conditions not only prevent power from being conserved, they also impose a 1.5s cooldown upon exit before the uma can conserve power again.

Entering spot struggle multiplies the currently conserved power by 0.95. Entering rushed multiplies the currently conserved power by 0.8.

Upon entering the [last spurt](./03-speed.md#last-spurt), if enough power has been conserved, acceleration is increased starting the next frame.
$Accel=sqrt((PowerStat-1200)*130)*0.001*StrategyDistanceCoefficient*ActivityCoefficient$
The strategy-distance coefficient is

|  | Short | Mile | Mid | Long |
| :---- | :---- | :---- | :---- | :---- |
| Front Runner | 1.0 | 1.0 | 1.0 | 1.0 |
| Pace Chaser | 0.7 | 0.8 | 0.9 | 0.9 |
| Late Surger | 0.75 | 0.7 | 0.875 | 1.0 |
| End Closer | 0.7 | 0.75 | 0.86 | 0.9 |

The activity coefficient is 1.0 multiplied by the following (stacking multiplicatively)

- 0.98x if the uma entered a [Spot Struggle](./09-spot-struggle.md#spot-struggle--lead-competition-位置取り争い)
- 0.8x if the uma experienced [Rushed](./08-position-keeping.md#rushed-kakari-掛かり-temptation)

$Duration=ConservedPower*sqrt(CourseDistance)*DistanceTypeCoef/1450$

| Distance | DistanceTypeCoef |
| :---- | :---- |
| Short | 0.45 |
| Mile | 1.0 |
| Mid | 0.875 |
| Long | 0.8 |

The release does not occur if the resulting duration is less than 0.2s

---

*[← Spot Struggle](./09-spot-struggle.md) · [Contents](../README.md) · [Compete Before Spurt →](./11-compete-before-spurt.md)*
