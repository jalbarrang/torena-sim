# Spot Struggle | Lead Competition 位置取り争い

A spot struggle may be triggered once any uma has traveled 150m from the start. It is triggered between 2 or more front runners or oonige that satisfy the following conditions:

- One of the uma has not reached 6th section
- They are close enough to the frontmost uma in their respective strategy:
  - $DistanceGap<3.75m$
  - $LaneGap<0.165*CourseWidth$

The spot struggle may be triggered once for each strategy. Front runners may struggle against each other, oonige may struggle against each other, but a regular front runner does not compete with an oonige.

The spot struggle cannot trigger if the foremost uma of the respective strategy is overtaken by a uma whose strategy should be behind them. For example, if a pace chaser is ahead of all front runners.

When a spot struggle is triggered, all uma that satisfy the proximity requirement gain additional target speed based on their guts stat.
$TargetSpeed+=(500*GutsStat{)}^{0.6}*0.0001[m/s]$
$Duration=(700*GutsStat{)}^{0.5}*0.012*StrategyProficiencyModifier[s]$

A uma will exit the spot struggle prematurely if she is too far away from other strugglers (regardless whether the other’s duration has run out):

- More than 5.0m ahead or behind
- More than 0.416 Course Width apart laterally

A spot struggle always ends when the 9th section is reached, regardless of whether duration has expired.

During a spot struggle, the [HP consumption](./05-hp.md#hp-consumption) rate is increased.

---

*[← Position Keeping](./08-position-keeping.md) · [Contents](../README.md) · [Charge Up →](./10-charge-up.md)*
