# Short Mechanics

## Start Delay, Late Start

When the race starts, a uma starts running after a random delay of up to 0.1s. The delay is NOT affected by wisdom. If the delay is more than 0.08s, it is considered a late start. If the delay is less than 0.02s, you gain a start dash score bonus in the team stadium.

The following skills changes the random start delay to a fixed number:

- アタシに指図しないで！！(0.085)
- 超遊び癖(0.1)

The following skills multiply the start delay:

- Concentration コンセントレーション 0.4x
- Focus 集中力 0.9x
- Gatekept ゲート難 1.5x

When start delay is less than 1 [frame](./01-concepts.md#frame-rate), acceleration and HP consumption are unaffected. The distance traveled on the first frame is $SpeedAfterAccel*(1\ frame-StartDelay)$.

When start delay is greater than 1 frame, no acceleration, HP consumption, or distance traveled calculation would take place. The loss of acceleration is particularly significant and may cause a uma to become blocked. Note that if the start delay is between 1 frame (0.066s) to 0.08s, there would be no late start warning.

## Dueling | Compete Fight 追い比べ

On the final straight of a race, competition may occur when uma are close to each other.

A pair of uma are considered dueling candidates if:

- At least one of them has entered the final straight
- $abs(DistanceGap)<3.0m$
- $abs(LaneGap)<0.25\ CourseWidth$

The dueling candidates must remain valid for 2 seconds to trigger dueling, furthermore:

- Both uma must have at least 15% HP
- $abs(SpeedGap)<0.6m/s$
- At least one of them must be in the top 50% in placement
- Neither uma may have already completed an earlier duel

Once dueling is triggered, the uma gains speed and acceleration based on her guts stat.
$TargetSpeed+=(200*GutsStat{)}^{0.708}*0.0001[m/s]$
$Accel+=(160*GutsStat{)}^{0.59}*0.0001[m/s]$

A duel may involve more than 2 uma. A new uma may join an existing dueling group by qualifying against any one active member. There can be multiple duel groups in a race.

A uma exits a duel when either:

- The HP falls below 5%
- The uma is more than 5m away ahead or behind every other member of the dueling group

A uma that has exited a duel can still keep other uma in her dueling group going, but not admit new uma into the dueling group.

## Stamina Limit Break スタミナ勝負

Note: Info in this section is inferred from the game’s parameter file, which is less concretely confirmed as results from reverse engineering. The details are still under investigation.

If the uma’s base stamina + skills bonus is higher than 1200, they will gain an additional target speed buff upon reaching max spurt speed. The buff lasts till the end of the race.

$TargetSpeedBuff=sqrt(StaminaStat-1200)*0.0085*DistanceFactor*RandomFactor[m/s]$

Distance Factor is determined by the racecourse distance:

- Distance \< 2101m, 0.0x
- Distance \< 2201m, 0.5x
- Distance \< 2401m, 1.0x
- Distance \< 2601m, 1.5x; 1.2x before 2024-10-29 update
- Distance \>= 2601m, 1.8x; 1.5x before 2024-10-29 update

How the Random Factor is calculated is unclear. The parameter file lists "TargetSpeedRandomTableChangeProbabilityByPower": 500 and the following table.

| Table Type | Probability | Coefficient |
| :---- | :---- | :---- |
| 0 | 50 | 0.98-1.00 |
| 1 | 30 | 0.95-0.98 |
| 2 | 20 | 1.00-1.02 |

## Zenkai Spurt 全開スパート

This mechanic was added on the 5th anniversary.

When a uma has more than 2000 Speed stat and has enough HP, after reaching target speed during the last spurt, she will activate zenkai spurt to continuously gain additional (target?) speed.

The maximum amount of speed that can be gained scales with the speed stat. The acceleration is different from the usual acceleration formula and scales with the power stat.

The acceleration is affected by skills specifically designed to interact with it (ID=48), though only applied at close to 10% its listed value for reasons unknown. The skill level scaling is the same as acceleration skills. The acceleration is unaffected by normal acceleration skills or conserve power / release.

The exact values are under investigation. In testing, the acceleration seems to continue until the uma reaches the finish line or runs out of HP, suggesting insufficient acceleration to reach the max speed. The acceleration is very close to
$Accel=0.068*AccelFromPower/(CourseDistanc{e/1000)}^{1.5}+SkillModifier$

If a uma runs out of HP during zenkai spurt, her speed is immediately dropped to the minimum speed rather than decelerating over time. This was confirmed to be a bug.

## Finish Time

When a uma crosses the finish line, the last frame is interpolated to get a finish time with more precision than one frame.

The race time displayed on the scoreboard is different from the actual race time used for internal calculation or animation.
$DisplayedTime=ActualTime*1.18$

There is a lower bound to each race’s display time. For example, 2400m Tokyo turf races have a lower bound of 2m21s6. Should a uma break the lower bound, the displayed time will be the lower bound ± up to 1 second. There is an upper bound too.

The finish distance difference is calculated by multiplying the scaled finish time difference by 15m/s.

- Nose ハナ = 0.2m
- Head アタマ = 0.4m
- Neck クビ = 0.8m

## Misc Notes

Information in this section are just notes for my own reference.

### Initialization

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

### Frame

During the simulation of a race, each frame is divided into a number of steps. Within each step, uma are updated by the order of their gate number.

The steps are (incomplete list):

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

---

*[← Race Courses](./14-race-courses.md) · [Contents](../README.md)*
