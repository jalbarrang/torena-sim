# Concepts

## Frame Rate

The races are simulated at 0.0666s per tick (about 15 frames per second).

For the purpose of replay, the game records uma’s position each frame within 1 second of race start, or when a uma is within 25m before goal. Otherwise positions are recorded at 1 second  (rounded up to 16 frames) intervals.
(There used to be a visual bug where the winner seemed to lose in replay due to low accuracy recording. The 25m before goal part was introduced then as a fix.)

## Section

A race course is divided into 24 sections of equal distance. Sections are numbered from 1 to 24.

## Phase

A race is divided into 4 phases. Phases affect a uma’s behavior and target speed. Some skills only activate in a certain phase. Phases are numbered from 0 to 3.

- Early-race 序盤 (0): Section 1 to 4.
- Mid-race 中盤 (1): Section 5 to 16.
- Late-race 終盤 (2): Section 17 to 20.
- Last Spurt 最終盤 (3): Section 21 to 24. Not to be confused with the concept of last spurt.

During a race, the progress bar at top of the screen has a tick between early-race and mid-race, and another tick between mid-race and late-race. During the last spurt, the UI fades away.

## Bashin, Horse Length

Bashin (horse length) is a unit of distance.
$1Bashin\ =\ 2.5m$

---

*[← Introduction](./00-introduction.md) · [Contents](../README.md) · [Stats →](./02-stats.md)*
