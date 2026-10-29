# Wiz Limit Break Buff

This mechanic was added on the 5th anniversary.

When a uma has more than 1200 Wiz stat, skills that increase either target speed (ID=27) or current speed with natural deceleration (ID=22) gains extra effectiveness. This effect is limited to unique skills, evolved skills, rare (gold) skills. Inherited skills and normal (white) skills are unaffected.

$SkillValueIncrease=BaseSkillValue*PhaseStrategyCoefficient*WizMultiplier$

The Wiz multiplier checks the user’s Wiz stat minus 1200 against the following table. The Wiz stat used here is subject to motivation and skill modifiers, but not strategy proficiency.
Example: 1325 Wiz is 125 over. It corresponds to the 141 threshold and has a multiplier of 0.14.

| Wiz Threshold | Multiplier | Note |
| ----- | ----- | ----- |
| 1 | 0 | +0.02 per 20 |
| 21 | 0.02 |  |
| 41 | 0.04 |  |
| 61 | 0.06 |  |
| 81 | 0.08 |  |
| 101 | 0.1 |  |
| 121 | 0.12 |  |
| 141 | 0.14 |  |
| 161 | 0.16 |  |
| 181 | 0.18 |  |
| 201 | 0.2 |  |
| 221 | 0.26 | +0.06 per 20 |
| 241 | 0.32 |  |
| 261 | 0.38 |  |
| 281 | 0.44 |  |
| 301 | 0.5 |  |
| 321 | 0.56 |  |
| 341 | 0.62 |  |
| 361 | 0.68 |  |
| 381 | 0.74 |  |
| 401 | 0.8 |  |
| 421 | 0.81 | +0.01 per 20 |
| 441 | 0.82 |  |
| 461 | 0.83 |  |
| 481 | 0.84 |  |
| 501 | 0.85 |  |
| 521 | 0.86 |  |
| 541 | 0.87 |  |
| 561 | 0.88 |  |
| 581 | 0.89 |  |
| 601 | 0.9 |  |
| 621 | 0.91 |  |
| 641 | 0.92 |  |
| 661 | 0.93 |  |
| 681 | 0.94 |  |
| 701 | 0.95 |  |
| 721 | 0.96 |  |
| 741 | 0.97 |  |
| 761 | 0.98 |  |
| 781 | 0.99 |  |
| 801 | 1 |  |
| 901 | 1.01 | +0.01 per 100 |
| 1001 | 1.02 |  |
| 1101 | 1.03 |  |
| 1201 | 1.04 |  |
| 1301 | 1.05 |  |
| 1401 | 1.06 |  |
| 1501 | 1.07 |  |
| 1601 | 1.08 |  |
| 1701 | 1.09 |  |
| 1801 | 1.1 |  |
| 1901 | 1.11 |  |
| 9999 | 1.12 |  |

Phase strategy coefficient refers to the following table.

|  | Early-race | Mid-race | Late-race | Last Spurt |
| :---- | :---- | :---- | :---- | :---- |
| Front Runner | 0.26 | 0.23 | 0.19 | 0.16 |
| Pace Chaser | 0.21 | 0.21 | 0.21 | 0.21 |
| Late Surger | 0.19 | 0.18 | 0.23 | 0.24 |
| End Closer | 0.15 | 0.17 | 0.25 | 0.27 |
| Oonige | 0.26 | 0.23 | 0.19 | 0.16 |

There is supposedly also a coefficient by race distance. But it’s currently 1.0 for all distances. In other words it does nothing.

If a skill affects multiple uma (example: 祝福のフラワーガール), it is the wiz stat of the uma who activated the skill that determines the bonus.

---

*[← Secure Lead](./12-secure-lead.md) · [Contents](../README.md) · [Race Courses →](./14-race-courses.md)*
