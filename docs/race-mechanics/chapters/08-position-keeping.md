# Position Keeping

Position keeping affects target speed between [section](./01-concepts.md#section) 1 to 10. There are 5 modes besides normal mode. For front runners, there are 2 modes: speed up and overtake. For non-front runners, there are 2 modes: pace up and pace down. Then there is a shared pace up Ex mode.

## Normal Mode

The normal mode has no target speed modifier (1.0x).

When in normal mode, a check to enter non-normal modes is performed every 2 seconds. The check consists of an entry condition, and a wisdom check for specific modes.

Uma returns to normal mode once exit conditions are fulfilled, or after she has run in this mode for the length of 1 [section](./01-concepts.md#section) (3 sections for oonige; distance of 1 section is rounded down before multiplying). Once exited, there is a 1 second cooldown (followed by the aforementioned 2 seconds interval for a total of 3 seconds) before the checks are run again.

## Pacemaker

Position keep modes of non-front runner modes are determined based on their distance from the pacemaker.
The exact mechanism a pacemaker gets chosen is unclear. The only known information is that a range parameter 10.0 (meters?) and a count parameter 2(.0?) are used.
Prior to the 1.5 anniversary update, pacemaker was the first place uma among the most forward strategy.

## Front Runner Modes

Front runners try to take first place and maintain a lead ahead of the second place.

### Speed Up mode

Target speed modifier: 1.04x
Entry condition: uma is first place and less than 4.5m (front runner) / 17.5m (oonige) ahead of the uma behind. The distance is increased to 12.5m if she is the only front runner after the 1.5th anniversary. Pass the wisdom check.
$Chance=20*lo{g}_{10}(WizStat*0.1)\ [%]$
Exit condition: uma is more than 4.5m (front runner) / 17.5m (oonige) ahead of the second place. The distance is increased to 12.5m if there is exactly 1 front runner in the race (excluding oonige and style changes due to rushed) after the 1.5th anniversary.

### Overtake mode

Not to be confused with overtake target lane mode.
Target speed modifier: 1.05x
Entry condition: uma is not first place within the same strategy. Pass the wisdom check.
$Chance=20*lo{g}_{10}(WizStat*0.1)\ [%]$
Exit condition: uma is 10m (27.5m for oonige) ahead of second place among uma who have the same strategy.

## Non-Front Runner Modes

Non-front runners try to maintain their distance with the pacemaker between 2 distance thresholds. The distance thresholds are:
$CourseFactor=0.0008*(CourseLength-1000)+1.0$
Pace Chaser:	$Min=3.0\ [m]$	$Max=5.0*CourseFactor\ [m]$
Late Surger:	$Min=6.5*CourseFactor\ [m]$	$Max=7.0*CourseFactor\ [m]$
End Closer:	$Min=7.5*CourseFactor\ [m]$	$Max=8.0*CourseFactor\ [m]$

### Pace Up mode

Target speed modifier: 1.04x
Entry condition: uma’s distance from the pacemaker is above the maximum distance. Pass the wisdom check.
$Chance=15*lo{g}_{10}(WizStat*0.1)\ [%]$
Exit condition: uma’s distance from the pacemaker is below a random value between the thresholds.

### Pace Down mode

Target speed modifier: 0.945x if in the mid-race after 1.5 anniversary; 0.915x otherwise
Entry condition: uma’s distance from the pacemaker is below the minimum distance. No target speed or current speed up skill effect is active.
Exit condition: uma’s distance from the pacemaker is above a random value between the thresholds. After the 1.5 anniversary, if in mid-race, the maximum distance is replaced with $lerp(Min,\ Max,\ 0.5)$ before rolling the random value. Or when uma is affected by a skill that increases her current speed or target speed. (Debuffs used to also remove pace down mode. [\[example\]](https://x.com/hoffe_33/status/1555274618662834176) This was fixed on 2022-08-09.)

## Pace Up Ex Mode

Target speed modifier: 2.0x
Entry condition for front runners: another uma whose strategy should be behind is ahead of the uma.
Entry condition for others: pacemaker’s strategy should be behind the uma.
Exit condition: no other uma whose strategy should be behind is ahead of the uma.
This mode is prioritized over all other position keep modes. This mode was added after the 1.5 anniversary.

## Rushed, Kakari 掛かり, Temptation

Each uma rolls for the rushed state before the race starts. The chance is affected by wisdom.
$RushedChance=(6.5/lo{g}_{10}(0.1*WizStat+1){)}^{2}%$
Due to the game using the integer version of the random number generator, the actual chance is effectively rounded up to the nearest integer percentage.
Examples:

- 300 Wiz, 19.00%
- 600 Wiz, 13.26%→14%
- 900 Wiz, 11.01%→12%
- 1200 Wiz, 9.74%→10%

自制心 reduces the chance by flat 3%. i.e. 19% to 16%.

If a uma were to enter the rushed state, she would do so in a random [section](./01-concepts.md#section) between 2 to 9. She will enter the rushed state as soon as she enters the section.

While rushed, [HP consumption](./05-hp.md#hp-consumption) is increased. Rushed also forces the uma to change their position keeping strategy and succeed in all position keep wisdom rolls. Worth noting that this change in position keeping strategy only affects the AI, and does not affect things like strategy coefficient when calculating base target speed.

- Front Runners will enter speed up mode if there is a uma sufficiently close behind
- Pace Chasers will become runners
- Late Surgers have a 75% chance to become Front Runners, 25% chance to become Pace Chasers.
- End Closers have a 70% chance to become Front Runners, 20% chance to become Pace Chasers, 10% chance to become Late Surgers.

Every 3 seconds while rushed, the uma has a 55% chance to snap out of it. Rushed ends if the uma is still affected after 12 seconds. Debuffs worsening the rushed state overwrites any ongoing rushed timer to a fixed 5 seconds (no exit rolls).

---

*[← Lane](./07-lane.md) · [Contents](../README.md) · [Spot Struggle →](./09-spot-struggle.md)*
