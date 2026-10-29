# Acceleration

$Accel=BaseAccel*sqrt(500.0*PowerStat)*StrategyPhaseCoefficient*$
$GroundTypeProficiencyModifier*DistanceProficiencyModifier+$
$SkillModifier+StartDashModifier$

## Base Acceleration

Normally, $BaseAccel=0.0006[m/{s}^{2}]$.
When running [uphill](./14-race-courses.md#slope-outdated), $BaseAccel=0.0004[m/{s}^{2}]$ instead.

### Strategy phase coefficient

| Strategy | Early-race | Mid-race | Late-race & Last Spurt |
| :---- | :---- | :---- | :---- |
| Front Runner | 1.0 | 1.0 | 0.996 |
| Pace Chaser | 0.985 | 1.0 | 0.996 |
| Late Surger | 0.975 | 1.0 | 1.0 |
| End Closer | 0.945 | 1.0 | 0.997 |
| Oonige | 1.17 | 0.94 | 0.956 |

### Ground type proficiency modifier

| S | A | B | C | D | E | F | G |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.7 | 0.5 | 0.3 | 0.1 |

### Distance proficiency modifier

| S | A | B | C | D | E | F | G |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.6 | 0.5 | 0.4 |

## Start Dash

During a start dash, an uma gains $24.0m/{s}^{2}$ additional acceleration. Start dash ends when her speed reaches $0.85*BaseSpeed$.

At the game’s launch, it was possible to carry this acceleration past the speed threshold. This meant that an uma having power below a certain threshold would have better acceleration at the start. This was deemed a [bug](https://umamusume.jp/news/detail.php?id=336). As a fix, speed is capped at $0.85*BaseSpeed$ until the start dash modifier is removed, so that the extra acceleration cannot be carried over.

This fix in turn caused [another bug](https://x.com/hoffe_33/status/1810084051623280883) years later. If a uma is inflicted with a speed debuff during start dash, she would not be able to reach the speed threshold to lose the start dash modifier. This meant she would be unable to accelerate past the speed threshold until the debuff ends. This has since been fixed by making the trigger ignore current speed modifiers.

A uma can also be stuck in the start dash state if the course starts in an uphill. With low enough power, the target speed could be lower than the threshold speed. The speed will shoot up once the hill is over.

After the end of a start dash, a uma is usually unable to accelerate to [minimum speed](./03-speed.md#minimum-speed) within 1 frame. As a result her speed would be raised to minimum speed.

## Deceleration

Deceleration is determined by phase

- Early-race: $-1.2m/{s}^{2}$
- Mid-race: $-0.8m/{s}^{2}$
- Late-race: $-1.0m/{s}^{2}$
- Pace Down mode (overriding all above, after 1.5 anniversary): $-0.5m/{s}^{2}$
- Out of HP (overriding all above): $-1.2m/{s}^{2}$

---

*[← Speed](./03-speed.md) · [Contents](../README.md) · [HP →](./05-hp.md)*
