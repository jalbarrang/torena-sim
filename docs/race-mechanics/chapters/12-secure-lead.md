# Secure Lead リード確保

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

Secure lead can occur between section 11 and 15 of the race. It occurs when the uma’s lead against another uma who should be further behind according to their strategy is less than desirable. Every 2 seconds, if the lead is less than desirable, there is a 20% chance (should scale with wisdom, but the mechanics is unknown) for the uma to attempt to secure the lead.

$DesirableLead=StrategyCoefficient+0.0003*(CourseDistance+1000)[m]$
Desirable lead strategy coefficient

|  | Nige | Senkou | Sashi | Oikomi |
| :---- | :---- | :---- | :---- | :---- |
| Oonige | 2.0 | 7.0 | 8.0 | 8.0 |
| Nige |  | 4.0 | 8.0 | 8.0 |
| Senkou |  |  | 5.0 | 6.0 |
| Sashi |  |  |  | 3.0 |

The uma speeds up for 2 seconds at the cost of stamina, then enters a cooldown of 1 second.
$TargetSpeedIncrease=(Guts/2000{)}^{0.5}*0.3*StrategyCoefficient[m/s]$

| Strategy | Strategy Coefficient |
| :---- | :---- |
| Oonige | 0.2 |
| Nige | 1.0 |
| Senkou | 1.0 |
| Sashi | 0.8 |

$StaminaConsumption=20*StrategyCoefficient*CourseDistanceCoefficient$
Stamina consumption strategy coefficient

| Strategy | Stamina Consumption Coefficient |
| :---- | :---- |
| Oonige | 1.2 |
| Nige | 1.0 |
| Senkou | 0.8 |
| Sashi | 0.8 |

Stamina consumption course distance coefficient

- Distance \< 1401m, 0.3x
- Distance \< 1801m, 0.3x \[sic\]
- Distance \< 2101m, 0.5x
- Distance \< 2201m, 0.8x
- Distance \< 2401m, 1.0x
- Distance \< 2601m, 1.1x
- Distance \>= 2601m, 1.2x

If a nige uma does not have another uma with the same strategy within 10m, their bonus is further multiplied by the following factor. (There is an unexplained 20% threshold for this bonus.)

| Strategy | Strategy Coefficient |
| :---- | :---- |
| Oonige | 7.0 |
| Nige | 2.0 (4.0 after 5.0 anniversary) |

---

*[← Compete Before Spurt](./11-compete-before-spurt.md) · [Contents](../README.md) · [Wiz Limit Break Buff →](./13-wiz-limit-break-buff.md)*
