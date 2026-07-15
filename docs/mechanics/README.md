# Uma Musume Race Mechanics - Global Server Edition

by KuromiAK

The majority of the information we know about racing logic comes from reverse engineering done by [@umamusu_reveng](https://twitter.com/umamusu_reveng), who has stopped their activity, [@kak_eng](https://twitter.com/kak_eng) and [@hoffe_33](https://twitter.com/hoffe_33). Information here is not guaranteed to be correct, though most has been verified by in-game observation.

The developers have stopped including new race mechanics in the client application. So most new mechanics after the 1st anniversary described are speculations based on the game's parameter file, packet captures of the race replay data, and manual testing. Information related to skills and existing mechanics is still accurate to my knowledge.

Beware that some mechanics and bugs differ based on your respective server. You can find such differences in the same section that describes the mechanic.

[Concepts](#concepts)

[Frame Rate](#frame-rate)

[Section](#section)

[Phase](#phase)

[Bashin, Horse Length](#bashin,-horse-length)

[Stats](#stats)

[Raw Stats](#raw-stats)

[Base Stats](#base-stats)

[Motivation Coefficient](#motivation-coefficient)

[Adjusted Stats](#adjusted-stats)

[Ground Modifier](#ground-modifier)

[Strategy Proficiency Modifier](#strategy-proficiency-modifier)

[Race Course Modifier](#race-course-modifier)

[Single Mode Modifier](#single-mode-modifier)

[Speed](#speed)

[Target Speed](#target-speed)

[Slope Modifier](#slope-modifier)

[Base Speed](#base-speed)

[Base Target Speed](#base-target-speed)

[Strategy Phase Coefficient](#strategy-phase-coefficient)

[Distance Proficiency Modifier](#distance-proficiency-modifier)

[Randomness Per Section](#randomness-per-section)

[Last Spurt](#last-spurt)

[Starting Speed](#starting-speed)

[Minimum Speed](#minimum-speed)

[Blocking](#blocking)

[Current Speed](#current-speed)

[Acceleration](#acceleration)

[Base Acceleration](#base-acceleration)

[Strategy phase coefficient](#strategy-phase-coefficient-1)

[Ground type proficiency modifier](#ground-type-proficiency-modifier)

[Distance proficiency modifier](#distance-proficiency-modifier-1)

[Start Dash](#start-dash)

[Deceleration](#deceleration)

[HP](#hp)

[Stamina](#stamina)

[Strategy Coefficient](#strategy-coefficient)

[HP Consumption](#hp-consumption)

[HP Recovery Skills](#hp-recovery-skills)

[Out of HP](#out-of-hp)

[Skills](#skills)

[Skill Activation Chance](#skill-activation-chance)

[Skill Ability](#skill-ability)

[CurrentSpeed (21)](<#currentspeed-(21)>)

[CurrentSpeedWithNaturalDeceleration (22)](<#currentspeedwithnaturaldeceleration-(22)>)

[Skill Duration](#skill-duration)

[Skill Cooldown](#skill-cooldown)

[Skill Conditions](#skill-conditions)

[x_random](#x_random)

[straight_random](#straight_random)

[corner_random](#corner_random)

[all_corner_random](#all_corner_random)

[phase_corner_random](#phase_corner_random)

[phase](#phase-1)

[remain_distance](#remain_distance)

[order_rate, order_rate_inXX_continue](#order_rate,-order_rate_inxx_continue)

[near_count](#near_count)

[is_surrounded](#is_surrounded)

[behind_near_lane_time, infront_near_lane_time](#behind_near_lane_time,-infront_near_lane_time)

[activate_count_x](#activate_count_x)

[Skill Target](#skill-target)

[Skill Level](#skill-level)

[Value Scaling, Ability Value Usage](#value-scaling,-ability-value-usage)

[Direct (1)](<#direct-(1)>)

[MultiplySkillNum (2)](<#multiplyskillnum-(2)>)

[Aoharu Skills (3-7)](<#aoharu-skills-(3-7)>)\`\`\`\`

[Multiply Random (8, 9\)](<#multiply-random-(8,-9)>)

[Climax Skills (10)](<#climax-skills-(10)>)

[MultiplyMaximumRawStatus (13)](<#multiplymaximumrawstatus-(13)>)

[MultiplyActivateSpecificTagSkillCount (14)](<#multiplyactivatespecifictagskillcount-(14)>)

[AddDistanceDiffTop (19)](<#adddistancedifftop-(19)>)

[MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (20, 21\)](<#multiplyblockedsidemaxcontinuetimephasemiddlerun-(20,-21)>)

[MultiplySpeed (22, 23\)](<#multiplyspeed-(22,-23)>)

[MultiplyArcGlobalPotentialLevel (24)](<#multiplyarcglobalpotentiallevel-(24)>)

[MultiplyTopLeadAmount (25)](<#multiplytopleadamount-(25)>)

[Duration Scaling, Ability Time Usage](#duration-scaling,-ability-time-usage)

[Direct (1)](<#direct-(1)-1>)

[MultiplyDistanceDiffTop (2)](<#multiplydistancedifftop-(2)>)

[MultiplyRemainHp (3, 7\)](<#multiplyremainhp-(3,-7)>)

[IncrementOrderUp (4)](<#incrementorderup-(4)>)

[MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (5, 6\)](<#multiplyblockedsidemaxcontinuetimephasemiddlerun-(5,-6)>)

[Additional Activate](#additional-activate)

[OrderUp (1)](<#orderup-(1)>)

[AdditionalActivateActivateAnySkill (2, 3\)](<#additionalactivateactivateanyskill-(2,-3)>)

[Lane](#lane)

[Lane Change Speed](#lane-change-speed)

[Target Lane](#target-lane)

[Overtake Targets](#overtake-targets)

[Normal Mode](#normal-mode)

[Overtake Mode](#overtake-mode)

[Fixed Mode](#fixed-mode)

[Extra Move Lane (Final Corner Lane)](<#extra-move-lane-(final-corner-lane)>)

[Blocking](#blocking-1)

[Front Blocking](#front-blocking)

[Side Blocking](#side-blocking)

[Overlapping](#overlapping)

[Vision](#vision)

[Start Delay, Late Start](#start-delay,-late-start)

[Position Keeping](#position-keeping)

[Pacemaker](#pacemaker)

[Front Runner Modes](#front-runner-modes)

[Speed up mode](#speed-up-mode)

[Overtake mode](#overtake-mode-1)

[Non-Front Runner Modes](#non-front-runner-modes)

[Pace up mode](#pace-up-mode)

[Pace down mode](#pace-down-mode)

[Pace Up Ex Mode](#pace-up-ex-mode)

[Rushed, Kakari 掛かり, Temptation](#rushed,-kakari-掛かり,-temptation)

[Spot Struggle | Lead Competition 位置取り争い](#spot-struggle-|-lead-competition-位置取り争い)

[Dueling](#dueling)

[Fully Charged](#fully-charged)

[Compete Before Spurt 位置取り調整](#repositioning-位置取り調整)

[Stamina Keep 持久力温存](#stamina-keep-持久力温存)

[Secure Lead リード確保](#secure-lead-リード確保)

[Stamina Limit Break スタミナ勝負](#stamina-limit-break-スタミナ勝負)

[Race Time](#race-time)

[Race Courses](#race-courses)

[Position, World Transform](#position,-world-transform)

[Course Distance to World Transform](#course-distance-to-world-transform)

[Slope (Outdated)](<#slope-(outdated)>)

[Course Events](#course-events)

[Misc Notes](#misc-notes)

[Initialization](#initialization)

[Frame](#frame)

# Concepts {#concepts}

## Frame Rate {#frame-rate}

The races are simulated at 0.0666s per tick (about 15 frames per second).

For the purpose of replay, the game records uma’s position each frame within 1 second of race start, or when a uma is within 25m before goal. Otherwise positions are recorded at 1 second intervals.
(There used to be a visual bug where the winner seemed to lose in replay due to low accuracy recording. The 25m before goal part was introduced then as a fix.)

## Section {#section}

A race course is divided into 24 sections of equal distance. Sections are numbered from 1 to 24\.

## Phase {#phase}

A race is divided into 4 phases. Phases affect a uma’s behavior and target speed. Some skills only activate in a certain phase. Phases are numbered from 0 to 3\.

| Phase          | Section                                                               |
| :------------- | :-------------------------------------------------------------------- |
| Early-race (0) | Section 1 to 4\.                                                      |
| Mid-race (1)   | Section 5 to 16\.                                                     |
| Late-race (2)  | Section 17 to 20\.                                                    |
| Last Spurt (3) | Section 21 to 24\. Not to be confused with the concept of last spurt. |

During a race, the progress bar at top of the screen has a tick between early-race and mid-race, and another tick between mid-race and late-race. During the last spurt, the UI fades away.

## Bashin, Horse Length {#bashin,-horse-length}

Bashin (horse length) is a unit of distance.
1Bashin \= 2.5m

# Stats {#stats}

Each stat is clamped between 1 and 2000\.
FinalStat=AdjustedStat+SkillModifier

## Raw Stats {#raw-stats}

Raw stats are the stats shown in the stat panel.
Raw stats past 1200 are halved before being converted to base stats.

## Base Stats {#base-stats}

Base stats are raw stats modified by motivation. This number is used sometimes instead of the final stat, most notably by [skill activation chance](#skill-activation-chance).
Base stat is clamped between 1 and 2000\.
BaseStat=(RawStats+AoharuTeamRankBonus)\*MotivationCoef

### Motivation Coefficient {#motivation-coefficient}

| Great | Good | Normal | Bad  | Awful |
| :---- | :--- | :----- | :--- | :---- |
| 1.04  | 1.02 | 1.0    | 0.98 | 0.96  |

## Adjusted Stats {#adjusted-stats}

Each adjusted stat is clamped between 1 and 2000\.
AdjustedSpeed=BaseSpeed\*RaceCourseModifier+GroundModifier+SingleModeModifier
AdjustedStamina=BaseStamina+SingleModeModifier
AdjustedPower=BasePower+GroundModifier+SingleModeModifier
AdjustedGuts=BaseGuts+SingleModeModifier
AdjustedWit=BaseWit\*StrategyProficiencyModifier+SingleModeModifier

### Ground Modifier {#ground-modifier}

Ground modifier for speed

|      | Firm | Good | Soft | Heavy |
| :--- | :--- | :--- | :--- | :---- |
| Turf | 0    | 0    | 0    | \-50  |
| Dirt | 0    | 0    | 0    | \-50  |

Ground modifier for power

|      | Firm  | Good | Soft  | Heavy |
| :--- | :---- | :--- | :---- | :---- |
| Turf | 0     | \-50 | \-50  | \-50  |
| Dirt | \-100 | \-50 | \-100 | \-100 |

### Strategy Proficiency Modifier {#strategy-proficiency-modifier}

| S   | A   | B    | C    | D   | E   | F   | G   |
| :-- | :-- | :--- | :--- | :-- | :-- | :-- | :-- |
| 1.1 | 1.0 | 0.85 | 0.75 | 0.6 | 0.4 | 0.2 | 0.1 |

### Race Course Modifier {#race-course-modifier}

Some race courses have 1-2 stats as threshold stats. Having [base stat](#base-stats) that exceeds threshold provides a bonus to adjusted speed.

| Threshold Stat      | Bonus  |
| :------------------ | :----- |
| \<= 300             | +0.05x |
| 300 \< Stat \<= 600 | +0.1x  |
| 600 \< Stat \<= 900 | +0.15x |
| 900 \< Stat         | +0.2x  |

The final modifier is the average of modifiers for all threshold stats. Therefore the maximum bonus achievable is \+0.2x.

### Single Mode Modifier {#single-mode-modifier}

In single mode (a.k.a. training), all uma gain 400 adjusted stats.

# Speed {#speed}

## Target Speed {#target-speed}

Target speed is the speed a uma will trend towards. When below the target speed, a uma will accelerate. When above the target speed, a uma will decelerate. Target speed cannot go below [minimum speed](#minimum-speed) or exceed 30 m/s.
TargetSpeed=(BaseTargetSpeed|LastSpurtSpeed)\*PositionKeepCoef+
ForceInModifier+SkillModifier+SlopeModifier+MoveLaneModifier

Position keeping coefficient is covered in [its own section](#position-keeping).

Force-in modifier is applied in the early-race when an uma is more than 0.12 course width away from the inner fence and inside is open. The random number is rolled once at race start.
ForceInModifier=Random(0.1)+StrategyModifier\[m/s\]
Strategy modifier is

| Strategy     | Strategy Modifier |
| :----------- | :---------------- |
| Front Runner | 0.02m/s           |
| Pace Chaser  | 0.01m/s           |
| Late Surger  | 0.01m/s           |
| End Closer   | 0.03m/s           |

Move lane modifier is applied when an uma is affected by a skill that modifies lane move speed, and has performed lane movement in the previous frame. Note that this was added after the 1st anniversary.
MoveLaneModifier=(0.0002\*PowerStat)0.5\[m/s\]

### Slope Modifier {#slope-modifier}

Slope modifier is applied when a uma is running on uphill or downhill, see [Course Events](#course-events).

When running uphill, a uma loses target speed equal to SlopePer\*200/PowerStat. When running downhill, every second there is a chance of WitStat\*0.04% to enter downhill accel mode that increases target speed by 0.3+SlopePer/10 \[m/s\] and reduces HP consumption by 60%. Each second the downhill accel mode has a 20% chance to end.

## Base Speed {#base-speed}

A race’s base speed is determined by race course distance.
BaseSpeed=20.0-(CourseDistance-2000m)/1000\[m/s\]
Examples:

- 1200m races have a base speed of 20.8m/s
- 2000m races have a base speed of 20.0m/s
- 2500m races have a base speed of 19.5m/s

## Base Target Speed {#base-target-speed}

The formula for base target speed varies depending on [phase](#phase).
During early-race and mid-race,
BaseTargetSpeed=BaseSpeed\*StrategyPhaseCoef
Worth noting that target speed is NOT affected by speed stat in early-race and mid-race.

During late-race and last spurt,
BaseTargetSpeed=BaseSpeed\*StrategyPhaseCoef+sqrt(500\*SpeedStat)\*DistanceProficiencyModifier\*0.002\[m/s\]

### Strategy Phase Coefficient {#strategy-phase-coefficient}

| Strategy     | Early-race | Mid-race | Late-race & Last Spurt |
| :----------- | :--------- | :------- | :--------------------- |
| Front Runner | 1.0        | 0.98     | 0.962                  |
| Pace Chaser  | 0.978      | 0.991    | 0.975                  |
| Late Surger  | 0.938      | 0.998    | 0.994                  |
| End Closer   | 0.931      | 1.0      | 1.0                    |
| Runaway      | 1.063      | 0.962    | 0.95                   |

### Distance Proficiency Modifier {#distance-proficiency-modifier}

| S    | A   | B   | C   | D   | E   | F   | G   |
| :--- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.6 | 0.4 | 0.2 | 0.1 |

### Randomness Per Section {#randomness-per-section}

At each [section](#section), [race base speed](#base-speed) multiplied by a random number is added to target speed. The random number is affected by Wit stat. This randomness does not affect the last spurt calculation.
Max=WitStat/5500\*log10(WitStat\*0.1)\[%\]
Min=Max-0.65\[%\]
Examples:

- 400 Wit, Max=+0.117%, Min=-0.533%
- 800 Wit, Max=+0.277%, Min=-0.373%

## Last Spurt {#last-spurt}

Last spurt distance and target speed are calculated at the beginning of the mid-race (without randomness per section). The concept of last spurt is not to be confused with the [last spurt phase](#phase).
LastSpurtSpeedMax=(BaseTargetSpeedPhase2+0.01\*BaseSpeed)\*1.05+
sqrt(500\*SpeedStat)\*DistanceProficiencyModifier\*0.002+
(450\*GutsStat)0.597\*0.0001\[m/s\]
Note that the guts component was added after the 1st anniversary.

Upon entering the late-race, if the uma has enough HP to run the remaining distance at max target speed, she will immediately start the last spurt using the max target speed.

If HP is insufficient, a list of last spurt speed and distance candidates are calculated by lowering the target speed by 0.1m/s each step, till the last spurt speed reaches base target speed of the late-race. Then candidates are sorted by the time it would take to finish the race (sum of respective distance divided by speed, ignoring acceleration). Going from best to worst time, each candidate has a chance of 15+0.05\*WitStat\[%\] chance to be accepted. If all candidates are exhausted without passing the Wit check, the slowest candidate is chosen.

Last spurt calculation estimates the stamina usage up to 60m before the goal line. The calculation does not take into account the time it takes to accelerate to target speed. If an HP recovery skill activates after entering the late-race, the last spurt speed and distance are re-calculated. Debuffs on the other hand do not trigger a re-calculation. Note that the recalculation was added after the 1st anniversary.

## Starting Speed {#starting-speed}

The speed at race start is 3m/s.

## Minimum Speed {#minimum-speed}

A uma’s minimum speed is affected by her guts.
MinSpeed=0.85\*BaseSpeed+sqrt(200.0\*GutsStat)\*0.001\[m/s\]

Minimum speed is the target speed when a uma is out of HP.

Minimum speed comes into effect after the [start dash](#start-dash). After each frame’s acceleration calculation, if a uma has less than minimum speed, her speed is instantly raised to match the minimum speed.

## Blocking {#blocking}

When blocked, a uma’s speed is capped between 0.988x(at 0m) to 1.0x(at 2m) of the speed of the uma in front, scaled linearly to the distance in between.

## Current Speed {#current-speed}

Speed debuffs affect actual speed (or distance covered, in a sense) after all other calculations. The change in speed is instant with no need for acceleration / deceleration.

# Acceleration {#acceleration}

Accel=BaseAccel\*sqrt(500.0\*PowerStat)\*StrategyPhaseCoefficient\*
GroundTypeProficiencyModifier\*DistanceProficiencyModifier+
SkillModifier+StartDashModifier

## Base Acceleration {#base-acceleration}

Normally, BaseAccel=0.0006\[m/s2\].
When running [uphill](<#slope-(outdated)>), BaseAccel=0.0004\[m/s2\] instead.

### Strategy phase coefficient {#strategy-phase-coefficient-1}

| Strategy     | Early-race | Mid-race | Late-race & Last Spurt |
| :----------- | :--------- | :------- | :--------------------- |
| Front Runner | 1.0        | 1.0      | 0.996                  |
| Pace Chaser  | 0.985      | 1.0      | 0.996                  |
| Late Surger  | 0.975      | 1.0      | 1.0                    |
| End Closer   | 0.945      | 1.0      | 0.997                  |
| Runaway      | 1.17       | 0.94     | 0.956                  |

### Ground type proficiency modifier {#ground-type-proficiency-modifier}

| S    | A   | B   | C   | D   | E   | F   | G   |
| :--- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1.05 | 1.0 | 0.9 | 0.8 | 0.7 | 0.5 | 0.3 | 0.1 |

### Distance proficiency modifier {#distance-proficiency-modifier-1}

| S   | A   | B   | C   | D   | E   | F   | G   |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.6 | 0.5 | 0.4 |

## Start Dash {#start-dash}

During a start dash, an uma gains 24.0m/s2 additional acceleration. Start dash ends when her speed reaches 0.85\*BaseSpeed.

At the game’s launch, it was possible to carry this acceleration past the speed threshold. This meant that an uma having power below a certain threshold would have better acceleration at the start. This was deemed a [bug](https://umamusume.jp/news/detail.php?id=336). As a fix, speed is capped at 0.85\*BaseSpeed until the start dash modifier is removed, so that the extra acceleration cannot be carried over.

This fix in turn caused [another bug](https://x.com/hoffe_33/status/1810084051623280883) years later. If a uma is inflicted with a speed debuff during start dash, she would not be able to reach the speed threshold to lose the start dash modifier. This meant she would be unable to accelerate past the speed threshold until the debuff ends. This has since been fixed by making the trigger ignore current speed modifiers.

A uma can also be stuck in the start dash state if the course starts in an uphill. With low enough power, the target speed could be lower than the threshold speed. The speed will shoot up once the hill is over.

After the end of a start dash, a uma is usually unable to accelerate to [minimum speed](#minimum-speed) within 1 frame. As a result her speed would be raised to minimum speed.

## Deceleration {#deceleration}

Deceleration is determined by phase

| Phase                                                        | Deceleration | In Global Server |
| :----------------------------------------------------------- | :----------- | ---------------- |
| Early-race                                                   | -1.2m/s2     | Yes              |
| Mid-race                                                     | -0.8m/s2     | Yes              |
| Late-race                                                    | -1.0m/s2     | Yes              |
| Pace Down mode (overriding all above, after 1.5 anniversary) | -0.5m/s2     | Yes              |
| Out of HP (overriding all above)                             | -1.2m/s2     | Yes              |

# HP {#hp}

## Stamina {#stamina}

Stamina is converted to HP at the start of a race.
MaxHP=0.8\*StrategyCoefficient\*StaminaStat+CourseDistance\[m\]

### Strategy Coefficient {#strategy-coefficient}

| Front Runner | Pace Chaser | Late Surger | End Closer | Runaway |
| :----------- | :---------- | :---------- | :--------- | :------ |
| 0.95         | 0.89        | 1.0         | 0.995      | 0.86    |

## HP Consumption {#hp-consumption}

HPConsumptionPerSecond=20.0\*(CurrentSpeed-BaseSpeed+12.0)2/144.0\*
StatusModifier\*GroundModifier

Status modifier is as follows (multiplicative):

- 1.6x during [rushed](#rushed,-kakari-掛かり,-temptation)
- 0.6x when position keeping status is pace-down.
- 0.4x when in down hill accel mode.

The ground modifier is affected by the track condition.

|      | Firm | Good | Soft | Heavy |
| :--- | :--- | :--- | :--- | :---- |
| Turf | 1    | 1    | 1.02 | 1.02  |
| Dirt | 1    | 1    | 1.01 | 1.02  |

In the late-race and last spurt, HP consumption is multiplied by guts modifier.
GutsModifier=1.0+(200/sqrt(600.0\*GutsStat))

Examples:

| Guts | Guts Modifier |
| :--- | :------------ |
| 200  | 1.577x        |
| 400  | 1.408x        |
| 600  | 1.333x        |

## HP Recovery Skills {#hp-recovery-skills}

HP can be recovered by skills. All skills that restore HP instantly restore a percentage of max HP. HP that goes over the max is wasted. All skills that restore HP functions identically outside their trigger condition and amount.

## Out of HP {#out-of-hp}

When a uma is out of HP, her target speed is set to [minimum speed](#minimum-speed).

# Skills {#skills}

See [https://gametora.com/umamusume/skills](https://gametora.com/umamusume/skills) for the list of skills and their conditions.

## Skill Activation Chance {#skill-activation-chance}

Many skills need to pass a Wit check BEFORE the race.
ActivationChance=max(100-9000/BaseWit,20)%

| Wit  | Activation Chance |
| :--- | :---------------- |
| 300  | 70.0%             |
| 600  | 85.0%             |
| 900  | 90.0%             |
| 1200 | 92.5%             |

Note that [base Wit stat](#base-stats) is used here. As a result the activation chance is NOT affected by strategy proficiency or skills.

## Skill Ability {#skill-ability}

“Ability” refers to individual effects of a skill.

#### ChangeStrategy (6) {#changestrategy-(6)}

The Runaway skill (`202051`) always activates at the gate and changes a Front Runner's pacing strategy to Runaway. The race-entry strategy remains Front Runner for skill conditions and other immutable configuration; only the position-keep strategy used by pacing mechanics is promoted. Source: the `202051` master-data effect and description in `src/modules/data/json/skills.json`, with the runtime field contract confirmed by the project owner.

#### RushedDuration (13) {#rushedduration-(13)}

The *Frenzied* family (`200791` Front Runners, `200801` Pace Chasers, `200811` Late Surgers, `200821` End Closers) targets an enemy running style (KakariStrategy) and extends a **currently-rushed** opponent's remaining rushed duration by +5s (raw `50000`), delaying the 12s cap-based exit. It is emitted from a live cast as a positive-modifier external effect and routed to matching-style opponents; a non-rushed target is a no-op. Source: the Frenzied master-data effects in `src/modules/data/json/skills.json` plus the Rushed State note above.

#### CurrentSpeed (21) {#currentspeed-(21)}

There are two variables for a uma’s current speed: Actual Speed (LastSpeed in code) and Current Speed (LastSelfSpeed in code).

Current speed is the direct result after acceleration calculations. It is fed into the next round of acceleration calculation. Current Speed is also used to calculate HP consumption per second.

Actual speed is current speed with current speed modifiers applied. Current speed modifiers are effective immediately without the need to accelerate or decelerate, unlike target speed, due to them being applied after acceleration calculation. Actual speed is used to compute distance traveled, as well as various calculations involving relative speed between two uma \- blocking, overtaking, etc.

#### CurrentSpeedWithNaturalDeceleration (22) {#currentspeedwithnaturaldeceleration-(22)}

This ability is composed of 2 parts.

1. A modifier that increases actual speed \- functionally identical to [CurrentSpeed](<#currentspeed-(21)>).
2. Once the first modifier expires, add a one-time modifier of equal magnitude that increases current speed.

## Skill Duration {#skill-duration}

Many skills have a base duration. The actual duration of a skill scales with course distance.
Duration=BaseDuration\*CourseDistance\[m\]/1000

## Skill Cooldown {#skill-cooldown}

Many skills have a cooldown time. The actual cooldown time of a skill scales with course distance.
Cooldown=BaseCooldown\*CourseDistance\[m\]/1000

## Skill Conditions {#skill-conditions}

### x_random {#x_random}

Skills with random activation randomly pick a 10m segment before a race starts, and activate when all other conditions are fulfilled while the uma is on the selected segment.

#### straight_random {#straight_random}

Skills that activate on random straights first randomly pick a straight segment to activate on, then randomly pick a 10m segment. The chance of each straight segment to be selected is equal regardless of their length.

#### corner_random {#corner_random}

If the race goes through the same [corner](#course-events) multiple times, the skill will activate on the last lap.

#### all_corner_random {#all_corner_random}

Up to 4 triggers are placed in the race, and the condition is fulfilled if uma is within one of the triggers. The triggers are distributed via the following procedure:

1. All corners in the race start as candidate corners.
2. Out of all candidate corners, randomly select one of them. The chance of each candidate to be chosen is equal regardless of their length.
3. Within the corner, randomly select a 10m-long segment, and place a trigger there.
   (Practically, this means distribution is uniform, but the latest trigger starting point is EndOfCorner-10m)
4. If there is at least 10m remaining from the end of the trigger to the end of that corner, the candidate is replaced by this remaining length. Otherwise the candidate is discarded.
5. Remove all candidate corners before the one selected.
6. Go to step 2, repeat until 4 triggers are placed, or no candidate remains.

#### phase_corner_random {#phase_corner_random}

All the corner segments in the corresponding phase are “stitched together” before the trigger is placed. This means the probability of the skill triggering in a specific corner is proportional to its length.

### phase {#phase-1}

Skill activations are checked before the game updates a uma’s phase.

A skill with the condition phase==1\&corner==0 (such as the original Smart Falcon’s unique skill) can activate if the uma exits a corner and enters the late-race on the same frame. This is because skill activation happens after checking the end of the corner and before updating the uma’s current phase.

### remain_distance {#remain_distance}

The remaining distance condition is calculated by subtracting the course distance (an integer) by the uma’s current position rounded down. So remain_distance\>=399 can actually trigger at remain_distance\>=398.000001.

### order_rate, order_rate_inXX_continue {#order_rate,-order_rate_inxx_continue}

Order rate condition is converted to order condition, rounding to the nearest.
For example, consider order_rate\>50 in a 9-uma race. 9\*50%=4.55. The condition is then converted to order\>5 and can only trigger when 6th place or below.

order_rate_inXX_continue requires an uma to remain in top XX% until skill activation. The first 5 seconds in the race do not count.

### near_count {#near_count}

A uma is considered near if
abs(DistanceGap)\<3m
abs(LaneGap)\<3HorseLane

- Note 1: Before the 1st anniversary changes, the distances used to be 1.5m and 1.5 horse lanes respectively.
- Note 2: We currently have the 1st anniversary changes in effect, so Note 1 is no longer applicable.

### is_surrounded {#is_surrounded}

A uma is considered surrounded if for all 3 of the following directions another uma can be found. The same uma can fulfill more than 1 direction.

Out: abs(DistanceGap)\<1.5m;0\<LaneGap\<3HorseLane
Front: 0\<DistanceGap\<3.0m;abs(LaneGap)\<1.5HorseLane
Behind: \-3.0m\<DistanceGap\<0;abs(LaneGap)\<1.5HorseLane

### behind_near_lane_time, infront_near_lane_time {#behind_near_lane_time,-infront_near_lane_time}

A uma is considered closely behind if
abs(DistanceGap)\<2.5m
abs(LaneGap)\<1HorseLane

This check is performed to the uma 1 place ahead/behind the uma in question. Skills use a timer of how long this condition has been continuously fulfilled as a trigger. The timers reset if the uma’s placement changes.

### activate_count_x {#activate_count_x}

Skill activations are checked in the order of their IDs. This means a skill with a lower ID can trigger a skill with a higher ID on the same frame, but not the other way around.

## Skill Target {#skill-target}

As far as targeting is concerned, skills do not distinguish friend and foe. This means teammates can trigger and be targeted by skills, and count towards a skill’s maximum target.

Teammates are excluded from the effect of debuffs.

## Skill Level {#skill-level}

Skills with levels gain extra effectiveness based on their effect type.

| Level | Target Speed | Accel | Stat | Everything Else \-Recovery,Current Speed,Lane move |
| :---- | :----------- | :---- | :--- | :------------------------------------------------- |
| 1     | 1.00         | 1.00  | 1.00 | 1.00                                               |
| 2     | 1.01         | 1.02  | 1.01 | 1.02                                               |
| 3     | 1.04         | 1.04  | 1.02 | 1.04                                               |
| 4     | 1.07         | 1.06  | 1.03 | 1.06                                               |
| 5     | 1.10         | 1.08  | 1.04 | 1.08                                               |
| 6     | 1.13         | 1.10  | 1.05 | 1.10                                               |
| 7     | 1.16         | 1.125 | 1.06 | 1.12                                               |
| 8     | 1.19         | 1.15  | 1.07 | 1.14                                               |
| 9     | 1.22         | 1.175 | 1.08 | 1.16                                               |
| 10    | 1.25         | 1.20  | 1.10 | 1.18                                               |

## Value Scaling, Ability Value Usage {#value-scaling,-ability-value-usage}

### Direct (1) {#direct-(1)}

No scaling.

### MultiplySkillNum (2) {#multiplyskillnum-(2)}

ScaledValue=min(1+0.01\*NumSkill, 1.2)

### Aoharu Skills (3-7) {#aoharu-skills-(3-7)}

The effectiveness of aoharu skills scales with your team’s total [base stats](#base-stats).

| Total                  | Effectiveness |
| :--------------------- | :------------ |
| Total \< 1200          | 0.8x          |
| 1200 \<= Total \< 1800 | 0.9x          |
| 1800 \<= Total \< 2600 | 1.0x          |
| 2600 \<= Total \< 3600 | 1.1x          |
| 3600 \<= Total         | 1.2x          |

### Multiply Random (8, 9\) {#multiply-random-(8,-9)}

Type 1 (ID=8) and Type 2 (ID=9) are identical.

| Percentage | Effectiveness |
| :--------- | :------------ |
| 60%        | 0.0x          |
| 30%        | 0.02x         |
| 10%        | 0.04x         |

### Climax Skills (10) {#climax-skills-(10)}

The effectiveness of climax skills scales with the number of races won during training.

| Races won              | Effectiveness |
| :--------------------- | :------------ |
| Races won \< 6         | 0.8x          |
| 6 \<= Races won \< 14  | 0.9x          |
| 14 \<= Races won \< 18 | 1.0x          |
| 18 \<= Races won \< 25 | 1.1x          |
| 25 \<= Races won       | 1.2x          |

In Global, this scaling is now relevant through **Trackblazer: Start of the Climax** scenario skills, such as **Glittering Star** / **Radiant Star**.

### MultiplyMaximumRawStatus (13) {#multiplymaximumrawstatus-(13)}

The effectiveness scales with the maximum raw stat of all 5 stats.

| Stat                  | Effectiveness |
| :-------------------- | :------------ |
| Stat \< 600           | 0.8x          |
| 600 \<= Stat \< 800   | 0.9x          |
| 800 \<= Stat \< 1000  | 1.0x          |
| 1000 \<= Stat \< 1100 | 1.1x          |
| 1100 \<= Stat         | 1.2x          |

### MultiplyActivateSpecificTagSkillCount (14) {#multiplyactivatespecifictagskillcount-(14)}

The effectiveness scales with the number of green skills (skill tag 601-615) activated during the race.

- 0-2 skills, 0.0x
- 3-4 skills, 1.0x
- 5 skills, 2.0x
- 6+ skills, 3.0x

### AddDistanceDiffTop (19) {#adddistancedifftop-(19)}

Adds a flat amount of effectiveness when far enough away from the first place.

| Distance         | Effectiveness |
| :--------------- | :------------ |
| Distance \< 20m  | \+0.0         |
| Distance \>= 20m | \+0.1         |

### MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (20, 21\) {#multiplyblockedsidemaxcontinuetimephasemiddlerun-(20,-21)}

Scales with the max duration the uma is [blocked](#side-blocking) on either side during the mid-race [phase](#phase). The duration of the longest occurrence of blockage is used. For each blockage, the timer is reset when both sides of the uma are clear from blocking. It is not reset when the blocking uma changes, or blocked from different sides from the beginning.

Type 1 (ID=20)

| Blocked        | Effectiveness |
| :------------- | :------------ |
| Blocked \< 2s  | 1.0x          |
| Blocked \< 4s  | 2.0x          |
| Blocked \< 6s  | 3.0x          |
| Blocked \>= 6s | 4.0x          |

Type 2 (ID=21) is not implemented yet.

### MultiplySpeed (22, 23\) {#multiplyspeed-(22,-23)}

Scales with the uma’s final speed stat. This includes raw stat, motivation modifier, ground modifier, race course modifier, and skills.

Type 1 (ID=22)

| Speed                  | Effectiveness |
| :--------------------- | :------------ |
| Speed \< 1700          | 0.0x          |
| 1700 \<= Speed \< 1800 | 1.0x          |
| 1800 \<= Speed \< 1900 | 2.0x          |
| 1900 \<= Speed \< 2000 | 3.0x          |
| 2000 \<= Speed         | 4.0x          |

Type 2 (ID=23)

| Speed                  | Effectiveness |
| :--------------------- | :------------ |
| Speed \< 1400          | 1.0x          |
| 1400 \<= Speed \< 1600 | 2.0x          |
| 1600 \<= Speed         | 3.0x          |

### MultiplyArcGlobalPotentialLevel (24) {#multiplyarcglobalpotentiallevel-(24)}

Scales with the uma’s total level of global potential in the L’arc scenario.

| Level           | Effectiveness |
| :-------------- | :------------ |
| Lv \< 10        | 1.0x          |
| 10 \<= Lv \< 20 | 1.1x          |
| 20 \<= Lv       | 1.2x          |

Note: Not implemented yet in Global Server.

### MultiplyTopLeadAmount (25) {#multiplytopleadamount-(25)}

Scales with the uma’s maximum lead achieved between 0-66.6% of the course distance.

| Lead                | Effectiveness |
| :------------------ | :------------ |
| Lead \< 10m         | 1.0x          |
| 10m \<= Lead \< 25m | 1.4x          |
| 25m \<= Lead        | 1.8x          |

## Duration Scaling, Ability Time Usage {#duration-scaling,-ability-time-usage}

### Direct (1) {#direct-(1)-1}

No scaling.

### MultiplyDistanceDiffTop (2) {#multiplydistancedifftop-(2)}

ScaledDuration=BaseDuration\*min(0.8+DistanceFromTop / 62.5m, 1.6)

### MultiplyRemainHp (3, 7\) {#multiplyremainhp-(3,-7)}

The duration scales with the remaining [HP](#hp) at the time of skill activation.
Type 1, for Mejiro Bright, Mejiro McQueen (ID=3)

| HP                  | Effectiveness |
| :------------------ | :------------ |
| HP \< 2000          | 1.0x          |
| 2000 \<= HP \< 2400 | 1.5x          |
| 2400 \<= HP \< 2600 | 2.0x          |
| 2600 \<= HP \< 2800 | 2.2x          |
| 2800 \<= HP \< 3000 | 2.5x          |
| 3000 \<= HP \< 3200 | 3.0x          |
| 3200 \<= HP \< 3500 | 3.5x          |
| 3500 \<= HP         | 4.0x          |

Type 2, for Matikane Tannhauser (ID=7)

| HP                  | Effectiveness |
| :------------------ | :------------ |
| HP \< 1500          | 1.0x          |
| 1500 \<= HP \< 1800 | 1.5x          |
| 1800 \<= HP \< 2000 | 2.0x          |
| 2000 \<= HP \< 2100 | 2.5x          |
| 2100 \<= HP         | 3.0x          |

### IncrementOrderUp (4) {#incrementorderup-(4)}

The duration increases by 1 second for each time the uma successfully overtakes while the skill is active, for up to 3 times. The increased duration applies to all modifiers applied by the skill. The additional duration also scales with course distance in the same way as base duration, see [Skill Duration](#skill-duration).

### MultiplyBlockedSideMaxContinueTimePhaseMiddleRun (5, 6\) {#multiplyblockedsidemaxcontinuetimephasemiddlerun-(5,-6)}

The same logic as the ability value counterpart, see [MultiplyBlockedSideMaxContinueTimePhaseMiddleRun](<#multiplyblockedsidemaxcontinuetimephasemiddlerun-(20,-21)>).
Type 1 (ID=5)

| Blocked        | Effectiveness |
| :------------- | :------------ |
| Blocked \< 2s  | 1.0x          |
| Blocked \< 4s  | 2.0x          |
| Blocked \< 6s  | 3.0x          |
| Blocked \>= 6s | 4.0x          |

Type 2 (ID=6) is not implemented yet.

## Additional Activate {#additional-activate}

If an ability is labeled as additional activation, it does nothing on skill activation. Instead the effect is applied when a certain condition is achieved while the skill is active, for the remaining skill duration. This effect can trigger multiple times.

### OrderUp (1) {#orderup-(1)}

Triggered each time the uma successfully overtakes. Up to 3 times.
This used to be AbilityValueUsage \= 19\.

### AdditionalActivateActivateAnySkill (2, 3\) {#additionalactivateactivateanyskill-(2,-3)}

Triggered each time the uma activates another skill.
Type 1 (ID=2) up to 3 times.
Type 2 (ID=3) up to 2 times.

# Lane {#lane}

A uma’s lane is measured by distance from the inner fence. The unit used in calculation is course width. 1 course width \= 11.25m. The game also uses the unit “horse lane” to measure relative distance, where 1 horse lane \= 1/18 course width.

The minimum lane distance is 0\. The maximum is different per race course. The widest race course is the turf course in Tokyo with 1.5 course width, and the narrowest being 3 dirt courses in Sapporo, Hakodate, Niigata with 1.1 course width.

The maximum may change throughout the race, though the only instances of this are Nakayama 2000m and some distances of Hanshin racecourse. It is unclear whether this would affect a race at all.

A uma’s initial lane is HorseIndex\*HorseLane+Adjustor where the adjustor is:

- 0 for Ooi
- 1.86 if gate \>= 14 for Longchamp (L'arc scenario)
- 0.6 if gate \>= 10 on other JRA courses

## Lane Change Speed {#lane-change-speed}

Lane move speed has 3 components: actual speed, current speed, and target speed.

TargetSpeed=0.02\*(0.3+0.001\*PowerStat)\*FirstMoveLanePointModifier\*OrderModifier
First move lane point modifier is applied in the early-race and mid-race, before the [move lane point](#course-events).
FirstMoveLanePointModifier=1+LaneDistance/MaxLaneDistance\*0.05
Order modifier is applied in the late-race and last spurt.
OrderModifier=1+Order\*0.01

Current speed changes towards target speed over time. This value is not directional. Acceleration is a constant. Current speed resets to 0 when the target lane is reached.
Accel=0.02\*1.5

Actual speed accounts for skills and is faster when moving in.

ActualSpeed=clamp(CurrentSpeed+SkillModifier,0, 0.6)\*DirectionModifier

Direction modifier is 1 when moving out. And affected by lane distance when moving in.
DirectionModifierOut=1
DirectionModifierIn=-(1+LaneDistance)

If the uma is blocked in the direction it is trying to move, the lane will not change. However the uma will continue to accelerate, building up current lane change speed in this case.

## Target Lane {#target-lane}

The target lane of a uma refers to the lane they try to move to. It is updated when a uma is less than 0.5 horse lane away from the current target lane, or if she is blocked on the side she is trying to move.

The first step is determining which strategy to use. There are 3 strategies: normal, fixed and overtake.

### Overtake Targets {#overtake-targets}

To enter overtake mode, there must be overtake targets. Overtake targets are all visible uma between 1-20 m in front, whose distance gap divided by speed gap is less than 15 \- meaning she can be caught up within 15 seconds at current speed difference \- and either has a lower target speed than yours, or be blocked and has a lower current speed than your target speed. The closest uma blocking in front is also automatically an overtake target.

### Normal Mode {#normal-mode}

Normal mode is used when there are no overtake targets, or when uma is within 200m before the [move lane point](#course-events) during early-race or mid-race.

Normal mode has the following rules:

1. If out of HP, set the target lane to the current lane.
2. If position keeping mode is pace-down, set the target lane to 0.18.
3. If on the final straight and [extra move lane](<#extra-move-lane-(final-corner-lane)>) is on the outside, set the target lane to the extra move lane if not blocked.
4. If in early-race or mid-race, set the target lane to the current lane \- 0.05 if not blocked.
5. If in mid-race and less than 1.75 horse lane from inside uma, set target lane to 2.0 horse lane away from inside uma.
6. Otherwise keep straight.

### Overtake Mode {#overtake-mode}

Overtake mode on the other hand is used when there are overtake targets. When all overtake targets are lost, the uma stays in overtake mode for an additional 1.5s before moving back to normal mode.

Overtake mode starts by making a list of overtake candidates. For each overtake target, find the innermost and outermost uma of the crowd they belong to. The specific condition is this:
0.0\<=DistanceGap\<=3.0
0\<LaneGap\<2HorseLane

For each inner/outermost uma, the lane \+/-1 horse lane is a candidate. The candidate is considered for next step if there is no visible uma within
OwnerDistance\<=Distance\<=Inner/OutermostUmaDistance+0.5
CandidateLane-0.8HorseLane\<=LaneDistance\<=CandidateLane+0.8HorseLane

There is an additional candidate unrelated to overtake targets. If the phase is the early-race or mid-race, and the uma is at least 1 horse lane from the fence, also check if 1 horse lane in is a candidate. Otherwise, check if going straight is a candidate.
OwnerDistance\<=Distance\<=FurthestAheadOvertakeTargetDistance+3.0
CandidateLane-0.8HorseLane\<=LaneDistance\<=CandidateLane+0.8HorseLane

If the uma doesn’t have enough lane space to either side to reach a candidate, the candidate is discarded. The remaining candidates are scored and the lowest scored candidate is accepted.

Score=abs(CandidateLane-LaneDistance)\*PhaseCoef
Phase coefficient differs by whether the candidate is inside or outside.

| Phase                 | Inside | Outside |
| :-------------------- | :----- | :------ |
| Early-race            | 1.0    | 100.0   |
| Mid-race              | 1.0    | 1.0     |
| Late-race, last spurt | 1.0    | 1.15    |

If no candidate is good, the current lane is accepted as a candidate.

Lastly, if the candidate accepted is to the inside of the extra move lane, and there is enough lane space to move to the extra move lane, the extra move lane is used as target lane. Otherwise the accepted candidate is used.

### Fixed Mode {#fixed-mode}

Fixed mode is used when affected by skill effects that affect target lane. In fixed mode, target lane is the lane specified by skill effect as long as the uma is not blocked from moving towards it.

### Extra Move Lane (Final Corner Lane) {#extra-move-lane-(final-corner-lane)}

Upon entering final corner, the extra move lane is set to clamp(LaneDistance/0.1,0,1)\*0.5+random(0.1)

Note that before the 1st anniversary, this used to activate on the final straight instead of the final corner.

## Blocking {#blocking-1}

### Front Blocking {#front-blocking}

The condition for a uma to block in front is
0\<DistanceGap\<2m
abs(LaneGap)\<=(1.0-0.6\*DistanceGap/2m)\*0.75HorseLane
This means the lane gap needed to be blocked is 0.3 horse lane when the other uma is 2m ahead, and 0.75 horse lane when 0m away. If multiple uma satisfy this criteria, the one with lowest distance gap is the blocking uma.

While blocked in the front, uma’s speed is limited to
(0.988+0.012\*(DistanceGap/2m))\*SpeedBlockFront.

### Side Blocking {#side-blocking}

The condition for a uma to block on either side is
abs(DistanceGap)\<1.05m
abs(LaneGap)\<2HorseLane
The uma with lowest lane gap determines how much space is available for movement.

Certain skills require being blocked on “all” sides. It means being blocked in front and on at least one side.

### Overlapping {#overlapping}

Two uma are considered overlapping if
abs(DistanceGap)\<0.4m
abs(LaneGap)\<0.4HorseLane

When 2 uma overlap, the one on the outside will be immediately bumped 0.4 horse lane away. This also triggers a target lane update for the uma outside.

## Vision {#vision}

A uma is visible if
DistanceGap\<=VisibleDistance
abs(LaneGap)\<=((DistanceGap/VisibleDistance)\*11.5HorseLane+2HorseLane)/2
Visible distance starts at 20m and is only modified by skills.

The formula suggests that the maximum width of the vision cone (triangle) is a constant unaffected by visible distance.

# Start Delay, Late Start {#start-delay,-late-start}

When the race starts, a uma starts running after a random delay of up to 0.1s. The delay is NOT affected by Wit. If the delay is more than 0.08s, it is considered a late start. If the delay is less than 0.02s, you gain a start dash score bonus in the team stadium.

The following skills changes the random start delay to a fixed number:

| Skill                        | Start Delay |
| :--------------------------- | :---------- |
| "You're Not the Boss of Me!" | 0.085       |
| "Feelin' a Bit Silly"        | 0.1         |

The following skills multiply the start delay:

| Skill           | Modifier |
| :-------------- | :------- |
| "Concentration" | 0.4x     |
| "Focus"         | 0.9x     |
| "Gatekept"      | 1.5x     |

When start delay is less than 1 [frame](#frame-rate), acceleration and HP consumption are unaffected. The distance traveled on the first frame is SpeedAfterAccel\*(1 frame-StartDelay).

When start delay is greater than 1 frame, no acceleration, HP consumption, or distance traveled calculation would take place. The loss of acceleration is particularly significant and may cause a uma to become blocked. Note that if the start delay is between 1 frame (0.066s) to 0.08s, there would be no late start warning.

# Position Keeping {#position-keeping}

Position keeping affects target speed between [section](#section) 1 to 10\. There are 5 modes besides normal mode. For front runners, there are 2 modes: speed up and overtake. For non-front runners, there are 2 modes: pace up and pace down. Then there is a shared pace up Ex mode.

When in normal mode, a check to enter non-normal modes is performed every 2 seconds. The check consists of an entry condition and sometimes a Wit check. Uma returns to normal mode once exit conditions are fulfilled, or after she has run in this mode for the length of 1 [section](#section) (3 sections for Runaway; distance of 1 section is rounded down before multiplying). Once exited, there is a 1 second cooldown (followed by the aforementioned 2 seconds interval for a total of 3 seconds) before the checks are run again.

## Pacemaker {#pacemaker}

Position keep modes of non-front runner modes are determined based on their distance from the pacemaker.
The exact mechanism a pacemaker gets chosen is unclear. The only known information is that a range parameter 10.0 (meters?) and a count parameter 2(.0?) are used.
Prior to the 1.5 anniversary update, pacemaker was the first place uma among the most forward strategy.

## Front Runner Modes {#front-runner-modes}

Front runners try to take first place and maintain a lead ahead of the second place.

### Speed up mode {#speed-up-mode}

Target speed modifier: 1.04x
Entry condition: uma is first place and less than 4.5m (front runner) / 17.5m (Runaway) ahead of the uma behind. The distance is increased to 12.5m if she is the only front runner after the 1.5th anniversary. Pass the Wit check.
Chance=20\*log10(WitStat\*0.1) \[%\]
Exit condition: uma is more than 4.5m (front runner) / 17.5m (Runaway) ahead of the second place. The distance is increased to 12.5m if she is the only front runner after the 1.5th anniversary.

### Overtake mode {#overtake-mode-1}

Not to be confused with overtake target lane mode.
Target speed modifier: 1.05x
Entry condition: uma is not first place within the same strategy. Pass the Wit check.
Chance=20\*log10(WitStat\*0.1) \[%\]
Exit condition: uma is 10m (27.5m for Runaway) ahead of second place among uma who have the same strategy.

## Non-Front Runner Modes {#non-front-runner-modes}

Non-front runners try to maintain their distance with the pacemaker between 2 distance thresholds. The distance thresholds are:
CourseFactor=0.0008\*(CourseLength-1000)+1.0

| Strategy    | Min Distance            | Max Distance            |
| :---------- | :---------------------- | :---------------------- |
| Pace Chaser | 3.0 \[m\]               | 5.0\*CourseFactor \[m\] |
| Late Surger | 6.5\*CourseFactor \[m\] | 7.0\*CourseFactor \[m\] |
| End Closer  | 7.5\*CourseFactor \[m\] | 8.0\*CourseFactor \[m\] |

### Pace up mode {#pace-up-mode}

Target speed modifier: 1.04x
Entry condition: uma’s distance from the 1st place is above the maximum distance. Pass the Wit check.
Chance=15\*log10(WitStat\*0.1) \[%\]
Exit condition: uma’s distance from the 1st place is below a random value between the thresholds.

### Pace down mode {#pace-down-mode}

Target speed modifier: 0.945x if in the mid-race after 1.5 anniversary; 0.915x otherwise
Entry condition: uma’s distance from the 1st place is below the minimum distance. No target speed or current speed up skill effect is active.
Exit condition: uma’s distance from the 1st place is above a random value between the thresholds. After the 1.5 anniversary, if in mid-race, the maximum distance is replaced with lerp(Min, Max, 0.5) before rolling the random value. Or when uma is affected by a skill that increases her current speed or target speed. (Debuffs used to also remove pace down mode. [\[example\]](https://x.com/hoffe_33/status/1555274618662834176) This was fixed on 2022-08-09 in JP, Global Server doesn't have the 1.5 anniversary update yet)

## Pace Up Ex Mode {#pace-up-ex-mode}

Target speed modifier: 2.0x
Entry condition for front runners: another uma whose strategy should be behind is ahead of the uma.
Entry condition for others: pacemaker’s strategy should be behind the uma.
Exit condition: no other uma whose strategy should be behind is ahead of the uma.
This mode is prioritized over all other position keep modes. This mode was added after the 1.5 anniversary and is available in Global.

## Rushed State {#rushed,-kakari-掛かり,-temptation}

Each uma rolls for the rushed state before the race starts. The chance is affected by Wit.
RushedChance=(6.5/log10(0.1\*WitStat+1))2%
Examples:

| Wit      | Rushed Chance |
| :------- | :------------ |
| 300 Wit  | 19.00%        |
| 600 Wit  | 13.26%        |
| 900 Wit  | 11.01%        |
| 1200 Wit | 9.74%         |

The "Restraint" skill (ID=202161) reduces the chance by flat 3%. i.e. 19% to 16%. Modeled generically as effect type 29 (`RushedChance`): the runner sums the type-29 modifiers on its own pending skills (raw `-30000` → `-3.0` → `-0.03` probability) before the pre-race rushed roll.

If a uma were to enter the rushed state, she would do so in a random [section](#section) between 2 to 9\. She will enter the rushed state as soon as she enters the section.

While rushed, HP consumption is increased to 1.6x. Rushed also forces the uma to change their position keeping strategy and succeed in all position keep Wit rolls. Worth noting that this change in position keeping strategy only affects the AI, and does not affect things like strategy coefficient when calculating base target speed.

- Front Runners will enter speed up mode.
- Pace Chasers will become Front Runners.
- Late Surgers have a 75% chance to become Front Runners, 25% chance to become Pace Chasers.
- End Closers have a 70% chance to become Front Runners, 20% chance to become Pace Chasers, 10% chance to become Late Surgers

Every 3 seconds while rushed, the uma has a 55% chance to snap out of it. Rushed ends if the uma is still affected after 12 seconds. Debuffs worsening the rushed state extends the timer by 5 seconds, this effect can be applied multiple times.

# Spot Struggle {#spot-struggle}

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. In the code, this mechanic is referred to as CompeteTop.

When there are 2 or more Front Runners or Runaways, Spot Struggle may be triggered between 150m from start to the 6th section.

> Real-data amendments ([hakuraku.moe/notes/spot-struggle](https://hakuraku.moe/notes/spot-struggle)): the 150m unlock is field-global — any uma passing 150m unlocks the mechanic for everyone, so trailing Front Runners can trigger before their own 150m mark. Only one of the umas involved needs to still be within section 6. The reference for the distance check is the FRONTMOST uma of the style: all umas within range of her enter together. Each style triggers at most once per race.

For Front Runners, their relative position must be:
DistanceGap\<3.75m
LaneGap\<0.165\*CourseWidth

> Real-data amendment: Runaway (Oonige) entry uses the same 3.75m / 0.165\*CourseWidth thresholds — replay data does not support a wider Oonige entry range. The `DistanceGap2: 5.0` / `LaneGap2: 0.416` constants are exit thresholds (see below).

Front Runners may compete with each other, Runaways may compete with each other, but a regular Front Runner does not compete with an Runaway.

During Spot Struggle, the Front Runners gain additional speed based on their guts stat.
TargetSpeed+=(500\*GutsStat)0.6\*0.0001\[m/s\]
Duration=(700\*GutsStat)0.5\*0.012\*StrategyProficiencyModifier\[s\]

> Real-data amendment: duration is scaled by the runner's strategy proficiency modifier (S 1.1, A 1.0, B 0.85, C 0.75, D 0.6, E 0.4, F 0.2, G 0.1) — the same table as the wit adjustment.

Lead competition always ends when the 9th section is reached, regardless of whether duration has expired.

> Real-data amendment (exit conditions): an uma also exits early once she is ≥5m behind ALL other active spot strugglers of her style, or ≥0.416\*CourseWidth away laterally from all of them. If every other participant left via this distance exit, the final struggler exits as well; natural duration expiry does NOT cascade.

During Spot Struggle, the HP consumption rate is multiplied by the following number:

- Front Runner: 1.4x
- Front Runner + Rushed: 3.6x
- Runaway: 3.5x
- Runaway + Rushed: 7.7x

# Dueling {#dueling}

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering.

On the final straight of a race, competition may occur when multiple uma are close to each other.
A uma is considered another uma’s competition target if
abs(DistanceGap)\<3.0m
abs(LaneGap)\<0.25 CourseWidth

If the competition target remains a target for more than 2 seconds, is top 50% in placement, and abs(SpeedGap)\<0.6m/s, a competition is triggered. The uma gains speed and acceleration based on her guts stat.
TargetSpeed+=(200\*GutsStat)0.708\*0.0001\[m/s\]
Accel+=(160\*GutsStat)0.59\*0.0001\[m/s\]

Competition cannot occur when HP is less than 15%, and will end if HP is reduced to below 5%.

> Real-data amendments ([hakuraku.moe/notes/dueling](https://hakuraku.moe/notes/dueling)):
>
> - The 2-second window applies to the proximity requirements only (distance + lane). HP, placement, and speed need to hold together on just one frame after the window elapses.
> - The final-straight requirement during the window applies to the duel TARGET only; the initiator may still be in the final corner and must be on the straight only at the trigger frame (replay: Maru duels 1.93s after entering the straight, kv=eJ1U_z6Sk6kzpkJeRhK48PXj).
> - Only ONE of the pair needs top-50% placement — that uma acts as the duel target. Both umas need ≥15% HP.
> - There is no strategy exclusion; front runners that fall back into the pack can duel. There is also no deadline — duels can begin even after the winner finishes.
> - Distance exit: an uma leaves a duel once separated by ≥5m (ahead OR behind) from every uma who has participated in a duel this race. Former participants cannot re-enter a duel or become new targets, but still count for keeping nearby duels alive — so the last active dueler does not automatically exit.

# Fully Charged {#fully-charged}

> Available in Global since 2026-07-01

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering.

The uma must have [base power](#base-stats) \+ skills bonus greater than 1200 to conserve power.

The following are mostly speculation:
Every 1.5 seconds (possibly scaling with course length?), the uma checks its state to increase or decrease conserved power.

Modes that increase conserved power:

- ID 1\. Position Keep Pace Down (6.7)
- ID 2\. Position Keep Normal Mode (4.2)

Modes that decrease conserved power:

- ID 3\. Spot Struggle (0.95)
- ID 4\. Rushed (0.8)

When conserved power is decreased, the following 2 categories of skill ability type seem to also play an unknown role:

- Lane Move Speed Up (28)
- Speed Up (27, 31, 21, 22\)

If there is enough conserved power, acceleration is increased at the start of the [last spurt](#last-spurt).Accel=sqrt((PowerStat-1200)\*130)\*0.001\*StrategyDistanceCoefficient\*ActivityCoefficient
The power stat is base power (not halved over 1200\) \+ skill bonus.
The strategy-distance coefficient is

|              | Short | Mile | Mid   | Long |
| :----------- | :---- | :--- | :---- | :--- |
| Front Runner | 1.0   | 1.0  | 1.0   | 1.0  |
| Pace Chaser  | 0.7   | 0.8  | 0.9   | 0.9  |
| Late Surger  | 0.75  | 0.7  | 0.875 | 1.0  |
| End Closer   | 0.7   | 0.75 | 0.86  | 0.9  |

The activity coefficient is

- ID 3\. Spot Struggle, 0.98
- ID 4\. Rushed, 0.8

The duration of the acceleration is unclear, but may depend on how much power has been conserved. It lasts about 3 seconds based on observation. The following coefficients seem to be related:
ActivityTimeCoef=1450

| Distance | ActivityTimeDistanceTypeCoef |
| :------- | :--------------------------- |
| Short    | 0.45                         |
| Mile     | 1.0                          |
| Mid      | 0.875                        |
| Long     | 0.8                          |

# Repositioning (位置取り調整) {#repositioning}

- These mechanics were added during the JP server's 2.5th anniversary on August 24, 2023.
- Not implemented yet in Global Server, will probably be available in the 2nd anniversary update.

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

Competing before spurt occurs between section 11 and 15 of the race. Every 2 seconds, a check is performed to see if she is too far from the first place (scaling with Wit), or has other umas nearby (scaling with guts, number of nearby uma, number of nearby uma with the same strategy). If the check succeeds, she enters a Compete Before Spurt mode.

The exact condition is unclear. It involves the following threshold and a number of other parameters.
Distance from the lead threshold (should scale with course distance)

| Strategy     | Distance |
| :----------- | :------- |
| Runaway      | 0.0      |
| Front Runner | 0.0      |
| Pace Chaser  | 2.5      |
| Late Surger  | 5.0      |
| End Closer   | 10.0     |

If the competition mode is activated, the uma speeds up at the cost of stamina for 2 seconds, then enters a cooldown of 1 second.
TargetSpeedIncrease=((Power/1500)0.5\*2.0+(Guts/3000)0.2)\*0.1\*StrategyCoefficient

| Strategy     | Strategy Coefficient |
| :----------- | :------------------- |
| Runaway      | 0.2                  |
| Front Runner | 0.8                  |
| Pace Chaser  | 1.0                  |
| Late Surger  | 1.0                  |
| End Closer   | 1.0                  |

StaminaConsumption=20\*(StrategyCoefficient\*DistanceCoefficient+NearFactor)
Stamina consumption strategy coefficient

| Strategy     | Stamina Consumption Coefficient |
| :----------- | :------------------------------ |
| Runaway      | 1.5                             |
| Front Runner | 1.2                             |
| Pace Chaser  | 1.0                             |
| Late Surger  | 1.0                             |
| End Closer   | 1.0                             |

Stamina consumption course distance coefficient

| Distance           | Stamina Consumption Coefficient |
| :----------------- | :------------------------------ |
| Distance \< 1401m  | 0.3x                            |
| Distance \< 1801m  | 0.3x \[sic\]                    |
| Distance \< 2101m  | 0.5x                            |
| Distance \< 2201m  | 0.8x                            |
| Distance \< 2401m  | 1.0x                            |
| Distance \< 2601m  | 1.1x                            |
| Distance \>= 2601m | 1.2x                            |

Near factor of 0.5 is applied if the uma is NOT far from the first place. In other words the mode is activated due to having uma nearby alone.

If a front runner uma does not have another uma with the same strategy within 10m, their bonus is further multiplied by the following factor. (There is an unexplained 20% threshold for this bonus.)

| Strategy     | Strategy Coefficient |
| :----------- | :------------------- |
| Runaway      | 2.0                  |
| Front Runner | 1.1                  |

## Stamina Conservation (持久力温存) {#stamina-keep}

- These mechanics were added during the JP server's 2.5th anniversary on August 24, 2023.
- Not implemented yet in Global Server, will probably be available in the 2nd anniversary update.

The uma will try to conserve a random amount of HP that is 1.035-1.04x the required amount to finish the race. Every 2 seconds, the uma checks if she has enough HP left. If she does not have enough HP, there is a chance of 30%\*(Wit/1000+Wisdom0.03) for her to notice and enter stamina keep mode. During stamina keep mode, the uma will not participate in the competition.

(The activation chance formula is highly speculative. We know that there are 3 parameters \- 30%, 1000 as a divisor, and 0.03 as an exponent. Packet capture testing has yielded 93/100 immediate activations with 1000 Wit, which is higher than what the current formula predicts.)

Activating a HP recovery skill will reset the stamina keeping state, allowing for the competition to activate if HP is now sufficient.

# Securing the Lead (リード確保) {#secure-lead-リード確保}

- This mechanic was added during the JP server's 2.5th anniversary on August 24, 2023.
- Not implemented yet in Global Server, will probably be available in the 2nd anniversary update.

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

Secure lead can occur between section 11 and 15 of the race. It occurs when the uma’s lead against another uma who should be further behind according to their strategy is less than desirable. Every 2 seconds, if the lead is less than desirable, there is a 20% chance (should scale with Wit, but the mechanics is unknown) for the uma to attempt to secure the lead.

DesirableLead=StrategyCoefficient+0.0003\*(CourseDistance+1000)\[m\]
Desirable lead strategy coefficient

|              | Front Runner | Pace Chaser | Late Surger | End Closer |
| :----------- | :----------- | :---------- | :---------- | :--------- |
| Runaway      | 2.0          | 7.0         | 8.0         | 8.0        |
| Front Runner |              | 4.0         | 8.0         | 8.0        |
| Pace Chaser  |              |             | 5.0         | 6.0        |
| Late Surger  |              |             |             | 3.0        |

The uma speeds up for 2 seconds at the cost of stamina, then enters a cooldown of 1 second.
TargetSpeedIncrease=(Guts/2000)0.5\*0.3\*StrategyCoefficient\[m/s\]

| Strategy     | Strategy Coefficient |
| :----------- | :------------------- |
| Runaway      | 0.2                  |
| Front Runner | 1.0                  |
| Pace Chaser  | 1.0                  |
| Late Surger  | 0.8                  |

StaminaConsumption=20\*StrategyCoefficient\*CourseDistanceCoefficient

Stamina consumption strategy coefficient

| Strategy     | Stamina Consumption Coefficient |
| :----------- | :------------------------------ |
| Runaway      | 1.2                             |
| Front Runner | 1.0                             |
| Pace Chaser  | 0.8                             |
| Late Surger  | 0.8                             |

Stamina consumption course distance coefficient

| Distance           | Stamina Consumption Coefficient |
| :----------------- | :------------------------------ |
| Distance \< 1401m  | 0.3x                            |
| Distance \< 1801m  | 0.3x \[sic\]                    |
| Distance \< 2101m  | 0.5x                            |
| Distance \< 2201m  | 0.8x                            |
| Distance \< 2401m  | 1.0x                            |
| Distance \< 2601m  | 1.1x                            |
| Distance \>= 2601m | 1.2x                            |

If a Front Runner uma does not have another uma with the same strategy within 10m, their bonus is further multiplied by the following factor. (There is an unexplained 20% threshold for this bonus.)

| Strategy     | Strategy Coefficient |
| :----------- | :------------------- |
| Runaway      | 7.0                  |
| Front Runner | 2.0                  |

# Stamina Contest (スタミナ勝負) {#stamina-limit-break-スタミナ勝負}

- This mechanic was added during the JP server's 2.5th anniversary on August 24, 2023.
- Not implemented yet in Global Server, will probably be available in the 2nd anniversary update.

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

If the uma’s base stamina \+ skills bonus is higher than 1200, they will gain an additional target speed buff upon reaching max spurt speed. The buff lasts till the end of the race.

TargetSpeedBuff=sqrt(StaminaStat-1200)\*0.0085\*DistanceFactor\*RandomFactor\[m/s\]

Distance Factor is determined by the racecourse distance:

| Distance           | Distance Factor              |
| :----------------- | :--------------------------- |
| Distance \< 2101m  | 0.0x                         |
| Distance \< 2201m  | 0.5x                         |
| Distance \< 2401m  | 1.0x                         |
| Distance \< 2601m  | 1.5x; 1.2x before 2024-10-29 |
| Distance \>= 2601m | 1.8x; 1.5x before 2024-10-29 |

How the Random Factor is calculated is unclear. The parameter file lists "TargetSpeedRandomTableChangeProbabilityByPower": 500 and the following table.

| Table Type | Probability | Coefficient |
| :--------- | :---------- | :---------- |
| 0          | 500000      | 0.98-1.00   |
| 1          | 300000      | 0.95-0.98   |
| 2          | 200000      | 1.00-1.02   |

# Race Time {#race-time}

The race time displayed on the scoreboard is different from the actual race time used for internal calculation or animation.
DisplayedTime=ActualTime\*1.18

There is a lower bound to each race’s display time. For example, 2400m Tokyo turf races have a lower bound of 2m21s6. Should a uma break the lower bound, the displayed time will be the lower bound plus up to 1 second. There is an upper bound too.

# Race Courses {#race-courses}

Information in this section is likely useless to anyone other than a data miner who wants to build a race simulator. The only takeaway for casual readers is that running on an outside lane causes your uma to travel additional distances.

## Position, World Transform {#position,-world-transform}

Each race course consists of 1001 “keyframes”, corresponding to 1000 equally distanced segments. Each keyframe consists of a 3D coordinate, and a rotation quaternion. Given course distance traveled, the position and rotation at Lane=0 is calculated by linearly interpolating between keyframes. Then the lane distance is taken into account by moving outside \- to the left of the current rotation if course is clockwise, or to the right if counter-clockwise \- by 11.25m per course width.
frame=Distance/CourseDistance\*1000
PoslaneOrigin=lerp(Pos\[floor(frame)\],Pos\[ceil(frame)\],frame-floor(frame))
Pos=PoslaneOrigin+CourseRotationRotationlaneOrigin(11.25m\*Lane)

### Course Distance to World Transform {#course-distance-to-world-transform}

The distance on the xz (horizontal) plane between two world transforms, divided by the difference in course distance, is the ratio of course distance to world transform.
ratio=Distance world/Distance course
The ratio between 0m and 1m travelled, at lane origin, is used as the base ratio for the race course. The base ratio ranges from 0.96 to 1.06 among race courses that are currently implemented.

Each frame’s ratio of course distance to world transform is also calculated. The course distance traveled being added at each frame is reduced if the ratio from the previous frame is greater than base ratio.
DistanceAddworld=DistanceAddcourse/max(1, ratioprev/ratiobase)
In practice this means running on the outside lane while cornering, or moving lanes, would result in travelling additional distance, modeled by less distance traveled.

### Slope (Outdated) {#slope-(outdated)}

**This section is outdated by the 1st anniversary update, where most race tracks got adjusted. For current effect, see [Course Events](#course-events).**
A uma’s rotation is converted to euler angle to determine the slope at any point of the race.
SlopePer=tan(slopeAngle)\*100
A slope is considered uphill if SlopePer\>1.0, or downhill if SlopePer\<-1.0. In other words, when there is more than 1m altitude difference over 100m distance.

## Course Events {#course-events}

Some parameters of a race course are defined as events that happen during a course. Each event is defined by its trigger location, with some having additional attributes.

| ID  | Name                 | Additional Attribute                                           | Notes                                                                                                           |
| :-- | :------------------- | :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| 0   | Corner               | Corner Number (1-4); Distance                                  |                                                                                                                 |
| 1   | Ground Change        |                                                                | Change of ground type from turf to dirt.                                                                        |
| 2   | Straight             | Start or End; Front Type (Front=1, Across=2, False Straight=3) | Each straight is defined by 2 events, the start and the end location.                                           |
| 3   | Lane Max Change      | New value                                                      | Change of the max lane value.                                                                                   |
| 4   | First BGM Landscape  |                                                                | Events of the same type ID existed before landscape mode was introduced, but their previous purpose is unknown. |
| 5   | Second BGM Landscape |                                                                |                                                                                                                 |
| 6   | Jikkyo Trigger       |                                                                | Unused                                                                                                          |
| 7   | Move Lane Point      |                                                                | In races without this parameter, the entry point of the initial corner is used. Only seen in Niigata 1000m.     |
| 8   | First BGM            |                                                                |                                                                                                                 |
| 9   | Second BGM           |                                                                |                                                                                                                 |
| 10  | Event Crowd          |                                                                | Unused                                                                                                          |
| 11  | Slope                | SlopePer; Length                                               |                                                                                                                 |

# Misc Notes {#misc-notes}

Information in this section are just notes for my own reference.

## Initialization {#initialization}

During race initialization, the following calculations are done in the listed order:

1. (Before initialization) Calculate base stats
2. Calculate skill activation chance and determine whether skills can activate
3. Activate all skills that would activate out of gate
4. Use item (an unimplemented item could prevent late start)
5. Set starting location based off gate number
6. Calculate start delay
7. Calculate adjusted stats
8. Convert stamina to HP
9. Set starting speed
10. Determine rushed

## Frame {#frame}

Each frame, the calculations are done in the listed order: (not complete list)

1. Pre-Update
   1. Check end of corner
2. Update
   1. Activate skills
   2. Recover HP by skills
   3. Update last spurt state
   4. Update target speed
   5. Calculate acceleration
   6. Update phase
   7. Calculate distance and position
   8. Check for slope
3. Post-Update
4. Events
   1. Check start of corner
