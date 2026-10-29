# Uma Musume Race Mechanics

by **KuromiAK**

A book-style edition of KuromiAK's reverse-engineered reference for how _Umamusume: Pretty Derby_ actually simulates a race — speed, acceleration, HP, skills, lane logic and the position-keeping modes. Formulas are kept as inline LaTeX (`$...$`).

## Contents

### Part I — Foundations

- **[Introduction](./chapters/00-introduction.md)** — Who wrote this, where the race-mechanics data comes from and how to read the document.
- **[Concepts](./chapters/01-concepts.md)** — Frame rate, sections, phases and bashin — the units the rest of the guide is built on.
- **[Stats](./chapters/02-stats.md)** — Raw, base and adjusted stats, and every modifier that turns one into the next.

### Part II — Movement & stamina

- **[Speed](./chapters/03-speed.md)** — Target speed, base speed, last spurt, blocking and minimum speed.
- **[Acceleration](./chapters/04-acceleration.md)** — Base acceleration, start dash and natural deceleration.
- **[HP](./chapters/05-hp.md)** — Stamina, HP consumption, recovery skills and what happens when a uma runs out.

### Part III — Skills

- **[Skills](./chapters/06-skills.md)** — Activation chance, ability/time/duration scaling and every skill condition the engine checks.

### Part IV — Track behaviour

- **[Lane](./chapters/07-lane.md)** — Lane-change speed, target lane, blocking, overlapping and vision.
- **[Position Keeping](./chapters/08-position-keeping.md)** — Pacemaker, front-runner and non-front-runner modes, pace-up-ex and the rushed state.
- **[Spot Struggle](./chapters/09-spot-struggle.md)** — The lead competition that starts when runners fight for the same position.
- **[Charge Up](./chapters/10-charge-up.md)** — Charge up / fully charged and conserve power / release, with their trigger conditions.
- **[Compete Before Spurt](./chapters/11-compete-before-spurt.md)** — Position adjustment before the last spurt, and the stamina-keep variant.
- **[Secure Lead](./chapters/12-secure-lead.md)** — The condition for holding the front and what it grants.
- **[Wiz Limit Break Buff](./chapters/13-wiz-limit-break-buff.md)** — The wisdom limit-break buff: triggers, values and stacking.

### Part V — Reference

- **[Race Courses](./chapters/14-race-courses.md)** — Position and world transform, slope, course events and lane geometry.
- **[Short Mechanics](./chapters/15-short-mechanics.md)** — Start delay, dueling, stamina limit break, zenkai spurt, finish time and misc frame notes.

## Global edition

For the short version scoped to what is live on the **Global** release — formulas, constants and thresholds, with JP-only mechanics flagged — start with [`GLOBAL.md`](./GLOBAL.md). It is maintained by hand; these chapters are its source.

## About this edition

- The prose is split, verbatim, from the single-file source into 15 chapters. Nothing was rewritten; heading levels, anchors and internal links were normalised for the book layout.
- The source's hand-written 127-entry table of contents is replaced by the contents above; all 172 internal links (contents entries plus in-prose cross-references) were rewritten to the new chapter files and GitHub-style anchors.
- The six shortest sections — Start delay, Dueling, Stamina limit break, Zenkai spurt, Finish time and Misc notes — are collected into [Short Mechanics](./chapters/15-short-mechanics.md).
- A cross-reference bug in the source is corrected here: the position-keeping bullet in [Charge Up](./chapters/10-charge-up.md) linked Lane's Normal Mode instead of Position Keeping's. See the editorial corrections in [`reports/split-report.md`](./reports/split-report.md).
- The untouched original is kept at [`archive/race-mechanics.md`](./archive/race-mechanics.md) as the source of truth.
- The transformation is reproducible: run `python split_guide.py`; it verifies the split and writes [`reports/split-report.md`](./reports/split-report.md).

> Content credit: **KuromiAK**. Mechanics derived from reverse engineering by [@umamusu_reveng](https://twitter.com/umamusu_reveng) and [@kak_eng](https://twitter.com/kak_eng) — see the introduction for the full credits.
