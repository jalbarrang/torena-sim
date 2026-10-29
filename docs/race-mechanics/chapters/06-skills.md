# Skills

See [https://gametora.com/umamusume/skills](https://gametora.com/umamusume/skills) for the list of skills and their conditions.

## Skill Activation Chance

Many skills need to pass a wisdom check BEFORE the race. Only skills whose `skill_data.activate_lot` is `1` roll this check; `activate_lot == 0` means the skill is guaranteed eligible and never rolls (its own activation condition still applies).
$ActivationChance=max(100-9000/BaseWiz,20)%$
Examples:

- 300 Wiz, 70.0%
- 600 Wiz, 85.0%
- 900 Wiz, 90.0%
- 1200 Wiz, 92.5%

Note that [base wisdom stat](./02-stats.md#base-stats) is used here. As a result the activation chance is NOT affected by strategy proficiency or skills.

## Skill Ability

“Ability” refers to individual effects of a skill.

### CurrentSpeed (21)

There are two variables for a uma’s current speed: Actual Speed (LastSpeed in code) and Current Speed (LastSelfSpeed in code).

Current speed is the direct result after acceleration calculations. It is fed into the next round of acceleration calculation. Current Speed is also used to calculate HP consumption per second.

Actual speed is current speed with current speed modifiers applied. Current speed modifiers are effective immediately without the need to accelerate or decelerate, unlike target speed, due to them being applied after acceleration calculation. Actual speed is used to compute distance traveled, as well as various calculations involving relative speed between two uma - blocking, overtaking, etc.

### CurrentSpeedWithNaturalDeceleration (22)

This ability is composed of 2 parts.

1. A modifier that increases actual speed - functionally identical to [CurrentSpeed](./06-skills.md#currentspeed-21).
2. Once the first modifier expires, add a one-time modifier of equal magnitude that increases current speed.

## Skill Duration

Many skills have a base duration. The actual duration of a skill scales with course distance.
$Duration=BaseDuration*CourseDistance[m]/1000$

## Skill Cooldown

Many skills have a cooldown time. The actual cooldown time of a skill scales with course distance.
$Cooldown=BaseCooldown*CourseDistance[m]/1000$

## Skill Conditions

### x\_random

Skills with random activation randomly pick a 10m segment before a race starts, and activate when all other conditions are fulfilled while the uma is on the selected segment.

#### straight\_random

Skills that activate on random straights first randomly pick a straight segment to activate on, then randomly pick a 10m segment. The chance of each straight segment to be selected is equal regardless of their length.

#### corner\_random

If the race goes through the same [corner](./14-race-courses.md#course-events) multiple times, the skill will activate on the last lap.

#### all\_corner\_random

Up to 4 triggers are placed in the race, and the condition is fulfilled if uma is within one of the triggers. The triggers are distributed via the following procedure:

1. All corners in the race start as candidate corners.
2. Out of all candidate corners, randomly select one of them. The chance of each candidate to be chosen is equal regardless of their length.
3. Within the corner, randomly select a 10m-long segment, and place a trigger there.
   (Practically, this means distribution is uniform, but the latest trigger starting point is $EndOfCorner-10m$)
4. If there is at least 10m remaining from the end of the trigger to the end of that corner, the candidate is replaced by this remaining length. Otherwise the candidate is discarded.
5. Remove all candidate corners before the one selected.
6. Go to step 2, repeat until 4 triggers are placed, or no candidate remains.

#### phase\_corner\_random

All the corner segments in the corresponding phase are “stitched together” before the trigger is placed. This means the probability of the skill triggering in a specific corner is proportional to its length.

### phase

Skill activations are checked before the game updates a uma’s phase.

A skill with the condition phase==1&corner==0 (such as the original Smart Falcon’s unique skill) can activate if the uma exits a corner and enters the late-race on the same frame. This is because skill activation happens after checking the end of the corner and before updating the uma’s current phase.

### remain\_distance

The remaining distance condition is calculated by subtracting the course distance (an integer) by the uma’s current position rounded down. So remain\_distance\>=399 can actually trigger at remain\_distance\>=398.000001.

### order\_rate, order\_rate\_inXX\_continue

Order rate condition is converted to order condition, rounding to the nearest.
For example, consider order\_rate\>50 in a 9-uma race. $9*50%=4.5\approx 5$. The condition is then converted to order\>5 and can only trigger when 6th place or below.

order\_rate\_inXX\_continue requires an uma to remain in top XX% until skill activation. The first 5 seconds in the race do not count.

### near\_count

A uma is considered near if
$abs(DistanceGap)<3m$
$abs(LaneGap)<3HorseLane$
Note that before the 1st anniversary, the distances used to be 1.5m and 1.5 horse lanes respectively.

### is\_surrounded

A uma is considered surrounded if for all 3 of the following directions another uma can be found. The same uma can fulfill more than 1 direction.
Out: $abs(DistanceGap)<1.5m;0<LaneGap<3HorseLane$
Front: $0<DistanceGap<3.0m;abs(LaneGap)<1.5HorseLane$
Behind: $-3.0m<DistanceGap<0;abs(LaneGap)<1.5HorseLane$

### behind\_near\_lane\_time, infront\_near\_lane\_time

A uma is considered closely behind if
$abs(DistanceGap)<2.5m$
$abs(LaneGap)<1HorseLane$

This check is performed to the uma 1 place ahead/behind the uma in question. Skills use a timer of how long this condition has been continuously fulfilled as a trigger. The timers reset if the uma’s placement changes.

### activate\_count\_x

Skill activations are checked in the order of their IDs. This means a skill with a lower ID can trigger a skill with a higher ID on the same frame, but not the other way around.

## Skill Target

As far as targeting is concerned, skills do not distinguish friend and foe. This means teammates can trigger and be targeted by skills, and count towards a skill’s maximum target.

Teammates are excluded from the effect of debuffs.

## Skill Level

Skills with levels gain extra effectiveness based on their effect type.

| Level | Target Speed | Accel | Stat | Everything Else -Recovery,Current Speed,Lane move |
| :---- | :---- | :---- | :---- | :---- |
| 1 | 1.00 | 1.00 | 1.00 | 1.00 |
| 2 | 1.01 | 1.02 | 1.01 | 1.02 |
| 3 | 1.04 | 1.04 | 1.02 | 1.04 |
| 4 | 1.07 | 1.06 | 1.03 | 1.06 |
| 5 | 1.10 | 1.08 | 1.04 | 1.08 |
| 6 | 1.13 | 1.10 | 1.05 | 1.10 |
| 7 | 1.16 | 1.125 | 1.06 | 1.12 |
| 8 | 1.19 | 1.15 | 1.07 | 1.14 |
| 9 | 1.22 | 1.175 | 1.08 | 1.16 |
| 10 | 1.25 | 1.20 | 1.10 | 1.18 |

## Value Scaling, Ability Value Usage

### Direct (1)

No scaling.

### MultiplySkillNum (2)

$ScaledValue=min(1+0.01*NumSkill,\ 1.2)$

### Aoharu Skills (3-7)

The effectiveness of aoharu skills scales with your team’s total [base stats](./02-stats.md#base-stats).

- Total \< 1200, 0.8x
- 1200 \<= Total \< 1800, 0.9x
- 1800 \<= Total \< 2600, 1.0x
- 2600 \<= Total \< 3600, 1.1x
- 3600 \<= Total, 1.2x

### Multiply Random (8, 9)

Type 1 (ID=8) and Type 2 (ID=9) are identical.

- 60%, 0.0x
- 30%, 0.02x
- 10%, 0.04x

### Climax Skills (10)

The effectiveness of climax skills scales with the number of races won during training.

- Races won \< 6, 0.8x
- 6 \<= Races won \< 14, 0.9x
- 14 \<= Races won \< 18, 1.0x
- 18 \<= Races won \< 25, 1.1x
- 25 \<= Races won, 1.2x

### MultiplyMaximumRawStatus (13)

The effectiveness scales with the maximum raw stat of all 5 stats.

- Stat \< 600, 0.8x
- 600 \<= Stat \< 800, 0.9x
- 800 \<= Stat \< 1000, 1.0x
- 1000 \<= Stat \< 1100, 1.1x
- 1100 \<= Stat, 1.2x

### MultiplyActivateSpecificTagSkillCount (14)

The effectiveness scales with the number of green skills (skill tag 601-615) activated during the race.

- 0-2 skills, 0.0x
- 3-4 skills, 1.0x
- 5 skills, 2.0x
- 6+ skills, 3.0x

### AddDistanceDiffTop (19)

Adds a flat amount of effectiveness when far enough away from the first place.

- Distance \< 20m, +0.0
- Distance \>= 20m, +0.1

### MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (20, 21)

Scales with the max duration the uma is [blocked](./07-lane.md#side-blocking) on either side during the mid-race [phase](./01-concepts.md#phase). The duration of the longest occurrence of blockage is used. For each blockage, the timer is reset when both sides of the uma are clear from blocking. It is not reset when the blocking uma changes, or blocked from different sides from the beginning.

Type 1 (ID=20)

- Blocked \< 2s, 1.0x
- Blocked \< 4s, 2.0x
- Blocked \< 6s, 3.0x
- Blocked \>= 6s, 4.0x

Type 2 (ID=21) is not implemented yet.

### MultiplySpeed (22, 23)

Scales with the uma’s final speed stat. This includes raw stat, motivation modifier, ground modifier, race course modifier, and skills.

Type 1 (ID=22)

- Speed \< 1700, 0.0x
- 1700 \<= Speed \< 1800, 1.0x
- 1800 \<= Speed \< 1900, 2.0x
- 1900 \<= Speed \< 2000, 3.0x
- 2000 \<= Speed, 4.0x

Type 2 (ID=23)

- Speed \< 1400, 1.0x
- 1400 \<= Speed \< 1600, 2.0x
- 1600 \<= Speed, 3.0x

### MultiplyArcGlobalPotentialLevel (24)

Scales with the uma’s total level of global potential in the L’arc scenario.

- Lv \< 10, 1.0x
- 10 \<= Lv \< 20, 1.1x
- 20 \<= Lv, 1.2x

### MultiplyTopLeadAmount (25)

Scales with the uma’s maximum lead achieved between 0-66.6% of the course distance.

- Lead \< 10m, 1.0x
- 10m \<= Lead \< 25m, 1.4x
- 25m \<= Lead, 1.8x

## Duration Scaling, Ability Time Usage

### Direct (1)

No scaling.

### MultiplyDistanceDiffTop (2)

$ScaledDuration=BaseDuration*min(0.8+DistanceFromTop\ /\ 62.5m,\ 1.6)$

### MultiplyRemainHp (3, 7)

The duration scales with the remaining [HP](./05-hp.md#hp) at the time of skill activation.
Type 1, for Mejiro Bright, Mejiro McQueen (ID=3)

- HP \< 2000, 1.0x
- 2000 \<= HP \< 2400, 1.5x
- 2400 \<= HP \< 2600, 2.0x
- 2600 \<= HP \< 2800, 2.2x
- 2800 \<= HP \< 3000, 2.5x
- 3000 \<= HP \< 3200, 3.0x
- 3200 \<= HP \< 3500, 3.5x
- 3500 \<= HP, 4.0x

Type 2, for Matikane Tannhauser (ID=7)

- HP \< 1500, 1.0x
- 1500 \<= HP \< 1800, 1.5x
- 1800 \<= HP \< 2000, 2.0x
- 2000 \<= HP \< 2100, 2.5x
- 2100 \<= HP, 3.0x

### IncrementOrderUp (4)

The duration increases by 1 second for each time the uma successfully overtakes while the skill is active, for up to 3 times. The increased duration applies to all modifiers applied by the skill. The additional duration also scales with course distance in the same way as base duration, see [Skill Duration](./06-skills.md#skill-duration).

### MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (5, 6)

The same logic as the ability value counterpart, see [MultiplyBlockedSideMaxContinueTimePhaseMiddleRun](./06-skills.md#multiplyblockedsidemaxcontinuetimephasemiddlerun-20-21).
Type 1 (ID=5)

- Blocked \< 2s, 1.0x
- Blocked \< 4s, 2.0x
- Blocked \< 6s, 3.0x
- Blocked \>= 6s, 4.0x

Type 2 (ID=6) is not implemented yet.

## Additional Activate

If an ability is labeled as additional activation, it does nothing on skill activation. Instead the effect is applied when a certain condition is achieved while the skill is active, for the remaining skill duration. This effect can trigger multiple times.

### OrderUp (1)

Triggered each time the uma successfully overtakes. Up to 3 times.
This used to be AbilityValueUsage = 19.

### AdditionalActivateActivateAnySkill (2, 3)

Triggered each time the uma activates another skill.
Type 1 (ID=2) up to 3 times.
Type 2 (ID=3) up to 2 times.

---

*[← HP](./05-hp.md) · [Contents](../README.md) · [Lane →](./07-lane.md)*
