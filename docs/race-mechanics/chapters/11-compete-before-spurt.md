# Compete Before Spurt 位置取り調整

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

Competing before spurt occurs between section 11 and 15 of the race. Every 2 seconds, a check is performed to see if she is too far from the first place (scaling with wisdom), or has other uma nearby (scaling with guts, number of nearby uma, number of nearby uma with the same strategy). If the check succeeds, she enters a competition mode.

The exact condition is unclear. It involves the following threshold and a number of other parameters.
Distance from the lead threshold (should scale with course distance)

| Strategy | Distance |
| :---- | :---- |
| Oonige | 0.0 |
| Nige | 0.0 |
| Senkou | 2.5 |
| Sashi | 5.0 |
| Oikomi | 10.0 |

If the competition mode is activated, the uma speeds up at the cost of stamina for 2 seconds, then enters a cooldown of 1 second.
$TargetSpeedIncrease=((Power/1500{)}^{0.5}*2.0+(Guts/3000{)}^{0.2})*0.1*StrategyCoefficient$

| Strategy | Strategy Coefficient |
| :---- | :---- |
| Oonige | 0.2 |
| Nige | 0.8 |
| Senkou | 1.0 |
| Sashi | 1.0 |
| Oikomi | 1.0 |

$StaminaConsumption=20*(StrategyCoefficient*DistanceCoefficient+NearFactor)$
Stamina consumption strategy coefficient

| Strategy | Stamina Consumption Coefficient |
| :---- | :---- |
| Oonige | 1.5 |
| Nige | 1.2 |
| Senkou | 1.0 |
| Sashi | 1.0 |
| Oikomi | 1.0 |

Stamina consumption course distance coefficient

- Distance \< 1401m, 0.3x
- Distance \< 1801m, 0.3x \[sic\]
- Distance \< 2101m, 0.5x
- Distance \< 2201m, 0.8x
- Distance \< 2401m, 1.0x
- Distance \< 2601m, 1.1x
- Distance \>= 2601m, 1.2x

Near factor of 0.5 is applied if the uma is NOT far from the first place. In other words the mode is activated due to having uma nearby alone.

If a front runner uma does not have another uma with the same strategy within 10m, their bonus is further multiplied by the following factor. (There is an unexplained 20% threshold for this bonus.)

| Strategy | Strategy Coefficient |
| :---- | :---- |
| Oonige | 2.0 |
| Nige | 1.1 |

## Stamina Keep 持久力温存

The uma will try to conserve a random amount of HP that is 1.035-1.04x the required amount to finish the race. Every 2 seconds, the uma checks if she has enough HP left. If she does not have enough HP, there is a chance of $30%*(Wisdom/1000{+Wisdom}^{0.03})$ for her to notice and enter stamina keep mode. During stamina keep mode, the uma will not participate in the competition.
(The activation chance formula is highly speculative. We know that there are 3 parameters - 30%, 1000 as a divisor, and 0.03 as an exponent. Packet capture testing has yielded 93/100 immediate activations with 1000 wisdom, which is higher than what the current formula predicts.)

Activating a HP recovery skill will reset the stamina keeping state, allowing for the competition to activate if HP is now sufficient.

---

*[← Charge Up](./10-charge-up.md) · [Contents](../README.md) · [Secure Lead →](./12-secure-lead.md)*
