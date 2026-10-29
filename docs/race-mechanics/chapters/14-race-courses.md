# Race Courses

Information in this section is likely useless to anyone other than a data miner who wants to build a race simulator. The only takeaway for casual readers is that running on an outside lane when cornering, or running diagonally, causes a uma to travel additional distances.

## Position, World Transform

Each race course consists of 1001 “keyframes”, corresponding to 1000 equally distanced segments. Each keyframe consists of a 3D coordinate, and a rotation quaternion. Given course distance traveled, the position and rotation at $Lane=0$ is calculated by linearly interpolating between keyframes. Then the lane distance is taken into account by moving outside - to the left of the current rotation if course is clockwise, or to the right if counter-clockwise - by 11.25m per course width.
$frame=Distance/CourseDistance*1000$
$Po{s}_{laneOrigin}=lerp(Pos[floor(frame)],Pos[ceil(frame)],frame-floor(frame))$
$Pos=Po{s}_{laneOrigin}+CourseRotation\times Rotatio{n}_{laneOrigin}\times (11.25m*Lane)$

### Course Distance to World Transform

The distance on the xz (horizontal) plane between two world transforms, divided by the difference in course distance, is the ratio of course distance to world transform.
$ratio=Distance{\ }_{world}/Distance{\ }_{course}$
The ratio between 0m and 1m travelled, at lane origin, is used as the base ratio for the race course. For calculating the base ratio specifically, 3D distance including the y axis is used instead of the horizontal distance. The base ratio ranges from 0.96 to 1.06 among race courses that are implemented at the time of writing.

Each frame’s ratio of course distance to world transform is also calculated. The course distance traveled being added at each frame is reduced if the ratio from the previous frame is greater than base ratio.
$DistanceAd{d}_{world}=DistanceAd{d}_{course}/max(1,\ rati{o}_{prev}/rati{o}_{base})$
In practice this means running on an outside lane while cornering, or running diagonally, would result in travelling additional distance, modeled by less distance traveled.

### Slope (Outdated)

**This section is outdated by the 1st anniversary update, where most race tracks got adjusted. For current effect, see [Course Events](./14-race-courses.md#course-events).**
A uma’s rotation is converted to euler angle to determine the slope at any point of the race.
$SlopePer=tan(slopeAngle)*100$
A slope is considered uphill if $SlopePer>1.0$, or downhill if $SlopePer<-1.0$. In other words, when there is more than 1m altitude difference over 100m distance.

## Course Events

Some parameters of a race course are defined as events that happen during a course. Each event is defined by its trigger location, with some having additional attributes.

| ID | Name | Additional Attribute | Notes |
| :---- | :---- | :---- | :---- |
| 0 | Corner | Corner Number (1-4); Distance |  |
| 1 | Ground Change |  | Change of ground type from turf to dirt. |
| 2 | Straight | Start or End; Front Type (Front=1, Across=2, False Straight=3) | Each straight is defined by 2 events, the start and the end location. |
| 3 | Lane Max Change | New value | Change of the max lane value. |
| 4 | First BGM Landscape |  | Events of the same type ID existed before landscape mode was introduced, but their previous purpose is unknown. |
| 5 | Second BGM Landscape |  |  |
| 6 | Jikkyo Trigger |  | Unused |
| 7 | Move Lane Point |  | In races without this parameter, the entry point of the initial corner is used. Only seen in Niigata 1000m. |
| 8 | First BGM |  |  |
| 9 | Second BGM |  |  |
| 10 | Event Crowd |  | Unused |
| 11 | Slope | SlopePer; Length |  |

---

*[← Wiz Limit Break Buff](./13-wiz-limit-break-buff.md) · [Contents](../README.md) · [Short Mechanics →](./15-short-mechanics.md)*
