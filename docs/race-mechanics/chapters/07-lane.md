# Lane

A uma’s lane is measured by distance from the inner fence. The unit used in calculation is course width. 1 course width = 11.25m. The game also uses the unit “horse lane” to measure relative distance, where 1 horse lane = 1/18 course width.

The minimum lane distance is 0. The maximum is different per race course. The widest race course is the turf course in Tokyo with 1.5 course width, and the narrowest being 3 dirt courses in Sapporo, Hakodate, Niigata with 1.1 course width.

The maximum may change throughout the race, though the only instances of this are Nakayama 2000m and some distances of Hanshin racecourse. It is unclear whether this would affect a race at all.

A uma’s initial lane is $(HorseIndex+Adjustor)*HorseLane$ where the adjustor is:

- 0 for Ooi, Kawasaki, Funabashi
- 1.86 if gate \>= 15 for Longchamp
- 0.6 if gate \>= 10 on other JRA courses

## Lane Change Speed

Lane move speed has 3 components: actual speed, current speed, and target speed.

$TargetSpeed=0.02*(0.3+0.001*PowerStat)*FirstMoveLanePointModifier*OrderModifier$
First move lane point modifier is applied in the early-race and mid-race, before the [move lane point](./14-race-courses.md#course-events).
$FirstMoveLanePointModifier=1+LaneDistance/MaxLaneDistance*0.05$
Order modifier is applied in the late-race and last spurt.
$OrderModifier=1+Order*0.01$

Current speed changes towards target speed over time. This value is not directional. Acceleration is a constant. Current speed resets to 0 when the target lane is reached.
$Accel=0.02*1.5$

Actual speed accounts for skills and is faster when moving in.
$ActualSpeed=clamp(CurrentSpeed+SkillModifier,0,\ 0.6)*DirectionModifier$
Direction modifier is 1 when moving out. And affected by lane distance when moving in.
$DirectionModifierOut=1$
$DirectionModifierIn=-(1+LaneDistance)$

If the uma is blocked in the direction it is trying to move, the lane will not change. However the uma will continue to accelerate, building up current lane change speed in this case.

## Target Lane

The target lane of a uma refers to the lane they try to move to. It is updated when a uma is less than 0.5 horse lane away from the current target lane, or if she is blocked on the side she is trying to move.

The first step is determining which strategy to use. There are 3 strategies: normal, fixed and overtake.

### Overtake Targets

To enter overtake mode, there must be overtake targets. Overtake targets are all visible uma between 1-20 m in front, whose distance gap divided by speed gap is less than 15 - meaning she can be caught up within 15 seconds at current speed difference - and either has a lower target speed than yours, or be blocked and has a lower current speed than your target speed. The closest uma blocking in front is also automatically an overtake target.

### Normal Mode

Normal mode is used when there are no overtake targets, or when uma is within 200m before the [move lane point](./14-race-courses.md#course-events) during early-race or mid-race.

Normal mode has the following rules:

1. If out of HP, set the target lane to the current lane.
2. If position keeping mode is pace-down, set the target lane to 0.18.
3. If during and after the final corner, and the [extra move lane](./07-lane.md#extra-move-lane-final-corner-lane) is on the outside, set the target lane to the extra move lane if not blocked.
4. If in early-race or mid-race, set the target lane to the current lane - 0.05 if not blocked.
5. If in mid-race and less than 1.75 horse lane from inside uma, set target lane to 2.0 horse lane away from inside uma.
6. Otherwise keep straight.

### Overtake Mode

Overtake mode on the other hand is used when there are overtake targets. When all overtake targets are lost, the uma stays in overtake mode for an additional 1.5s before moving back to normal mode.

Overtake mode starts by making a list of overtake candidates. For each overtake target, find the innermost and outermost uma of the crowd they belong to. The specific condition is this:
$0.0<=DistanceGap<=3.0$
$0<LaneGap<2HorseLane$

For each inner/outermost uma, the lane +/-1 horse lane is a candidate. The candidate is considered for next step if there is no visible uma within
$OwnerDistance<=Distance<=Inner/OutermostUmaDistance+0.5$
$CandidateLane-0.8HorseLane<=LaneDistance<=CandidateLane+0.8HorseLane$

There is an additional candidate unrelated to overtake targets. If the phase is the early-race or mid-race, and the uma is at least 1 horse lane from the fence, also check if 1 horse lane in is a candidate. Otherwise, check if going straight is a candidate.
$OwnerDistance<=Distance<=FurthestAheadOvertakeTargetDistance+3.0$
$CandidateLane-0.8HorseLane<=LaneDistance<=CandidateLane+0.8HorseLane$

If the uma doesn’t have enough lane space to either side to reach a candidate, the candidate is discarded. The remaining candidates are scored and the lowest scored candidate is accepted.

$Score=abs(CandidateLane-LaneDistance)*PhaseCoef$
Phase coefficient differs by whether the candidate is inside or outside.
Early-race: In = 1.0, Out = 100.0
Mid-race: In = 1.0, Out = 1.0
Late-race, last spurt: In = 1.0, Out =1.15

If no candidate is good, the current lane is accepted as a candidate.

Lastly, if the candidate accepted is to the inside of the extra move lane, and there is enough lane space to move to the extra move lane, the extra move lane is used as target lane. Otherwise the accepted candidate is used.

### Fixed Mode

Fixed mode is used when affected by skill effects that affect target lane. In fixed mode, target lane is the lane specified by skill effect as long as the uma is not blocked from moving towards it.

### Extra Move Lane (Final Corner Lane)

Upon entering final corner, the extra move lane is set to $clamp(LaneDistance/0.1,0,1)*0.5+random(0.1)$

Note that before the 1st anniversary, this used to activate on the final straight instead of the final corner.

## Blocking

### Front Blocking

The condition for a uma to block in front is
$0<DistanceGap<2m$
$abs(LaneGap)<=(1.0-0.6*DistanceGap/2m)*0.75HorseLane$
This means the lane gap needed to be blocked is 0.3 horse lane when the other uma is 2m ahead, and 0.75 horse lane when 0m away. If multiple uma satisfy this criteria, the one with lowest distance gap is the blocking uma.

While blocked in the front, uma’s speed is limited to
$(0.988+0.012*(DistanceGap/2m))*SpeedBlockFront$.

### Side Blocking

The condition for a uma to block on either side is
$abs(DistanceGap)<1.05m$
$abs(LaneGap)<2HorseLane$
The uma with lowest lane gap determines how much space is available for movement.

Certain skills require being blocked on “all” sides. It means being blocked in front and on at least one side.

### Overlapping

Two uma are considered overlapping if
$abs(DistanceGap)<0.4m$
$abs(LaneGap)<0.4HorseLane$

When 2 uma overlap, the one on the outside will be immediately bumped 0.4 horse lane away. This also triggers a target lane update for the uma outside.

## Vision

A uma is visible if
$DistanceGap<=VisibleDistance$
$abs(LaneGap)<=((DistanceGap/VisibleDistance)*11.5HorseLane+2HorseLane)/2$
Visible distance starts at 20m and is only modified by skills.

The formula suggests that the maximum width of the vision cone (triangle) is a constant unaffected by visible distance.

---

*[← Skills](./06-skills.md) · [Contents](../README.md) · [Position Keeping →](./08-position-keeping.md)*
