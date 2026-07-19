# Carat income sources — event handout values for Global

Pinned average carat/ticket handouts per timeline event type, for modeling the "timeline handouts" income component that `projectIncome` currently omits (taskman plan `carat-income-model-gaps`, t-004; consumed by t-005/t-006).

**Primary source:** the reference spreadsheet (`latias-pull-plan.xlsx`, Google Sheets export frozen 2026-07-18), compiled into `src/modules/carat/model/__fixtures__/reference-latias.json` (t-001). This document derives per-event-type values from the sheet's own itemized handout ledger and cross-checks them against public sources. All dates below are Global-server dates from the sheet's uma.moe-style catch-up projection.

**Scope caveat — catch-up compression.** The sheet's Global schedule runs events faster than the JP calendar while Global catches up (16 story events, 13 Champions Meetings, and 3 anniversary cycles land in the 366-day reference window). Per-event values are the stable unit; per-month and per-year aggregates below are only valid for the catch-up period and will decay toward JP cadence once Global syncs. Our timeline payload (uma.moe via `workers/timeline-proxy`) encodes the same compressed schedule, so accruing per event from the timeline automatically tracks this.

## 1. How the sheet computes "Timeline handouts" (column AL)

The reference workbook's Timeline sheet (sheet2) contains an itemized handout ledger. Each event block has three reward streams, each credited on a specific serial date:

| Stream | Ledger columns | Credited | Marker |
|---|---|---|---|
| First-day handouts (login gifts, mission unlocks) | AT (carats) + AU (label) | block start date | `AV = "k1"` row carries the block total |
| Throughout-event rewards (story event points, bingo, legend race wins) | AW (carats) + AX (label) | block end date | end serial on the `k1` row (AX) |
| Last-day handouts (final login days, countdown tails) | AT + AU | last-day serial | `AV = "k3"` row |

Sheet1's per-banner AL column is `SUM(FILTER(...))` over these streams up to each banner's end date. **Verification:** re-computing the first six frozen AL values (3,080 / 3,630 / 13,850 / 2,550 / 6,950 / 24,280) from the parsed ledger reproduces them exactly, and the 1-year summary decomposition (AL345+AL346+AL347 = 19,390 + 78,230 + 11,550 = 109,170) matches an item-level reconstruction within 0.2% (108,950; residual is items whose credit date straddles the window edge).

**Important:** the committed fixture's per-banner `timelineHandouts` field captures only the *first-day* stream (the first row of each banner block). It is a lower bound, not the full handout total — the full total for a window is first-day + throughout + last-day. Window-diffing the fixture column alone (the derivation originally planned for this task) captures only ~15–20% of the handout total (19,390 of 109,170 in the 1-year window); the itemized ledger below supersedes it.

### Observed aggregate: fixture AL window diffs (first-day stream only)

Diffs of the fixture's cumulative `timelineHandouts` between consecutive banner start dates. These are observed aggregates over windows, **not** per-event allocations; windows with zero change are omitted. Small negative diffs occur because the cumulative is evaluated at each banner's *end* serial, which is not monotonic in banner *start* order.

| Window (banner starts) | First-day handouts in window |
|---|---:|
| 2026-07-18 → 2026-07-22 | 3,080 |
| 2026-07-22 → 2026-09-15 | 550 |
| 2026-09-15 → 2026-10-09 | 580 |
| 2026-10-09 → 2026-11-12 | 2,740 |
| 2026-11-12 → 2026-11-29 | 3,320 |
| 2026-12-16 → 2027-01-27 | 1,320 |
| 2027-01-27 → 2027-02-18 | 80 |
| 2027-02-18 → 2027-04-05 | 3,240 |
| 2027-04-05 → 2027-04-18 | 1,080 |
| 2027-04-18 → 2027-05-14 | 80 |
| 2027-05-14 → 2027-07-02 | 3,240 |
| 2027-07-02 → 2027-08-12 | 3,980 |
| 2027-08-12 → 2027-08-24 | −500 |
| 2027-08-24 → 2027-11-29 | 2,400 |
| 2027-11-29 → 2027-12-17 | 3,160 |
| 2027-12-17 → 2028-02-01 | 1,240 |
| 2028-02-08 → 2028-03-14 | 2,080 |
| 2028-03-14 → 2028-04-24 | 3,400 |
| 2028-04-24 → 2028-05-26 | 580 |
| 2028-05-26 → 2028-06-30 | 240 |
| 2028-06-30 → 2028-07-19 | 80 |
| 2028-07-19 → 2028-08-29 | 3,240 |
| 2028-08-29 → 2028-10-14 | 160 |
| 2028-10-14 → 2028-11-20 | 2,160 |
| 2028-11-20 → 2028-11-24 | −80 |
| 2028-11-24 → 2029-01-05 | 3,400 |
| **Cumulative at 2029-01-05** | **44,850** |

The spikes align with anniversary/login-gift clusters (first-day credits); the ~80-carat trickle windows are new-uma story chapter unlocks. Marker-stream totals over the full fixture window (2026-07-18 → 2029-02-08): first-day 44,850 + throughout 249,280 + last-day 31,400 = **325,530 carats** of timeline handouts across ~31 months (≈ 10,400/mo during catch-up, tapering as the schedule normalizes).

## 2. Itemized derivation: reference 1-year window (2026-07-18 → 2027-07-19, 366 days)

Item-level classification of every ledger entry credited in the sheet's 1-year summary window. Sum: 108,950 vs the sheet's frozen 109,170 (−0.2%).

| Category | Carats (1y) | Items | Per-item derivation |
|---|---:|---:|---|
| Story event rewards ("Event Rewards (Story, Bingo, Event Pt)") | 34,560 | 16 | uniform 2,160/event in this window |
| Anniversary handouts (gifts, login bonuses, countdowns, celebration missions) | 27,350 | 17 | 3 anniversary cycles (1.5th, 2nd, 2.5th) ≈ 9,100/cycle |
| Recurring missions (G1 celebration 150 ea., Trainer Skill Test 1,550, Factor Study 900, Masters Challenge 4,500, Trainer's Road) | 19,400 | 55 | mostly 150-carat G1 mission drips |
| Seasonal login gifts (Christmas, New Year gifts/countdowns) | 10,900 | 9 | 500–3,000 per gift |
| Other recurring events (Aim for the Stars 1,500 ea., Racing Carnival 1,000 ea., April Fools 500) | 8,500 | 7 | |
| Legend race first-win carats | 6,000 | 24 | 250/featured uma, 2 umas per event |
| New-uma story chapters ("Uma Story Ch 1-4") | 2,240 | 28 | 80 per new playable uma release |
| **Total** | **108,950** | | ≈ **8,930/month** during catch-up |

## 3. Pinned values per timeline event type

Our timeline payload types: `story_event`, `legend_race`, `campaign`, `champions_meeting` (already modeled), plus the `anniversaries` array. Counts below are uma.moe events with `global_release_date` in the same 1-year window, from the cached payload (`results/reference-sheet/timeline-live.json`).

| Component | Pinned value (Global) | Sheet derivation | External source | Agreement |
|---|---|---|---|---|
| `story_event` carats | **2,160/event** (rises to 2,910/event for events from ~Sep 2027) | 16 uniform 2,160 items in 1y window; ledger history: 1,010 → 1,260 (Oct 2025) → 2,160 (Dec 2025 on) → 2,910 (Sep 2027 on) | [Game8: Hungry for a Miracle](https://game8.co/games/Umamusume-Pretty-Derby/archives/572724) and [Search! Solve! Summer!](https://game8.co/games/Umamusume-Pretty-Derby/archives/605094): 1,500 from event points; story episodes (7×30 = 210) and bingo-card carats (~150) on top ≈ 1,860+ all-in. [umareference](https://www.umareference.com/guide/currencies/jewels-carats): 1,260 total (older JP-era events) | 1.16x vs Game8 all-in (sheet plausibly counts mission carats Game8 doesn't itemize); 1.7x vs umareference's older-era total. Within tolerance |
| `story_event` tickets | **2 uma + 2 support scout tickets/event** | event-ticket ledger (BI/BJ) rises ~2/type around story event ends | [Game8: Halloween Makeover rewards table](https://game8.co/games/Umamusume-Pretty-Derby/archives/567645): Support Card Scout Ticket ×2, Trainee Scout Ticket ×2 | Exact |
| `legend_race` carats | **500/event** (250 per featured uma × 2 umas typical) | 39 blocks in fixture window, every item exactly 250, 1–2 umas per block; 6,000 over 1y (24 wins) | [umareference](https://www.umareference.com/guide/currencies/jewels-carats): "Legend Races — winning gives 250 jewels each". [Game8 Legend Race guide](https://game8.co/games/Umamusume-Pretty-Derby/archives/539754): 150 first-win bonus (+ mission/participation carats make up the rest) | Exact vs umareference; 1.67x vs Game8's first-win-only figure. Consistent |
| `campaign` carats | **≈3,500/event** as a residual average — low confidence, see below | residual (anniversary 27,350 + missions 19,400 + seasonal logins 10,900 + other 8,500 = 66,150/yr) ÷ 19 uma.moe `campaign` events in window | [LDShop 1st-anniversary guide](https://www.ldshop.gg/blog/umamusume-pretty-derby/1st-anniversary-guide.html): ~6,000+ carats across one anniversary's login phases — order-of-magnitude match for the anniversary share | Weak correlation: uma.moe "Mission Campaign" events do not map 1:1 onto the sheet's anniversary/mission/login categories. Prefer splitting: anniversaries ≈ 9,100/cycle from the `anniversaries` payload array + a flat residual ≈ 3,200/mo for missions/seasonal/other |
| 50-day login bonus | **150 carats per 50 cumulative login days** — confirmed | sheet formula AU42: `INT(DATEDIF(start,end,"D")/50)*150 + ...`; fixture `fiftyDayLogin` steps of 150 | [JP mission wiki (通算ログイン)](https://umamusume.wikiru.jp/?%E3%83%9F%E3%83%83%E3%82%B7%E3%83%A7%E3%83%B3=): 150 jewels every 50 days from day 50 | Exact |
| Valentine (Feb 14) | **500 carats one-off/year** | same AU42 formula adds `(DATEDIF(date_v,end,"Y")+1)*500` for Feb 14 | [Official Global notice (umamusume.gg)](https://umamusume.gg/valentines-day-celebration-giveaway/): 500 carats to all trainers, Feb 14 2026 | Exact |
| White Day (Mar 14) | **500 carats one-off/year** | same formula, Mar 14 term | [Official Global notice (umamusume.gg)](https://umamusume.gg/white-day-celebration-giveaway/): 500 carats, Mar 14 2026 | Exact |
| New-uma story chapters | 80 carats per new uma release (~28/yr during catch-up) | uniform 80-carat "Uma Story Ch 1-4" items | [fdaytalk carats guide](https://www.fdaytalk.com/how-to-get-carats-in-umamusume-pretty-derby/): character story episodes 30–50/episode (few episodes unlockable day one) | Same order; sheet's 80 is a first-day-claimable estimate. Low materiality (≈185/mo) |

**Not part of timeline handouts:** the sheet models the daily carat pack as **50 carats/day** (`AR` formula: `DATEDIF(...)*50` ≈ 1,520/mo, vs our 2,000/mo constant); this remains the separate t-009 discrepancy. The sheet also adds a "Misc Earnings Approximation" of 1,800/mo (gifts, team trials extras, careers) in column AV — **excluded** from its own 19,700 headline (`AI345 = SUM(AL,AN:AU)` skips AV).

## 4. t-006 verdict: training pass and League of Heroes

**Paid training pass:** `TRAINING_PASS_MATURE_MONTHLY_CARATS.paid` is **1,850/month**, not 2,200. The reference workbook's `AQ42` formula and frozen cumulative `AQ` ledger use the mature-tier total of **1,350 paid-pass rewards + 500 standard-pass rewards**. The [Training Pass reward list](https://wikiwiki.jp/vip_umamusu/%E3%83%88%E3%83%AC%E3%83%BC%E3%83%8B%E3%83%B3%E3%82%B0%E3%83%91%E3%82%B9) independently lists 500 jewels for the standard pass and 1,350 for premium rewards. The model therefore retains `free: 500` and changes the paid setting to the combined 1,850; paid-pass tickets remain 4 per pool per month.

**Release/tier timing:** Global projections use the workbook's dated tiers: no pass carats or tickets before 2027-08-12; an introductory **400/month free** or **1,300/month paid (900+400)** from 2027-08-12 through 2027-12-16; and the mature **500/month free** or **1,850/month paid (1,350+500)** from 2027-12-17. Pass tickets begin at the Global release and remain 2 per pool per month for free or 4 per pool per month for paid. Projections crossing either boundary integrate each tier over its active fraction of the window; JP retains the mature tier throughout because this Global release schedule does not establish a JP cutoff.

**League of Heroes cadence:** the 366-day reference window contains **five** Platinum 4 rewards, not twelve. The frozen `AT` cumulative ledger rises by exactly 3,300 five times, from 0 to 16,500; the lookup ledger dates are 2027-01-26, 03-11, 04-23, 06-04, and 07-17. The nearest succeeding banner rows independently show cumulative `AT` values of 3,300 (2027-01-27), 6,600 (2027-04-05), 9,900 (2027-04-18), 13,200 (2027-07-02), and 16,500 (2027-08-12). The payload supports only `campaign`, `story_event`, `champions_meeting`, and `legend_race`, with no distinct LoH event type, so `projectIncome` uses the documented expectation **5 / 12 events per month** rather than fabricating event dates. It preserves each selected-rank reward; Platinum 4 remains **3,300 carats + 4 combined tickets per event**, yielding an expected 1,375 carats and 1⅔ combined tickets per month.

## 5. Ticket sources (~29/month combined in the reference workbook)

From the sheet's 1-year ticket summary (BD345:BH345 per pool, doubled for uma+support; frozen values):

| Source | Per type / 1y | Combined / month | Notes |
|---|---:|---:|---|
| Monthly shop | 48 (4/mo) | 7.9 | matches our existing 4/type/mo baseline (sheet cell AU21 = 4) |
| Event tickets (story events, anniversaries, shops) | 76 | 12.5 | **missing from our model**; ≈2/type per story event + anniversary/campaign selectors |
| Champions Meeting (Third) | 39 (3/pool × 13 events) | 6.4 | equals our `third: 6 tickets` combined |
| League of Heroes (Platinum 4) | 10 (2/pool × 5 events) | 1.6 | equals our `platinum-4: 4 tickets` combined, but only 5 events/yr |
| Training pass tickets | 0 frozen (formula: 4/mo per pool if paid, from Global pass release) | 0 | activates late 2027 in the sheet's projection |
| **Total** | **173/type** | **≈28.4 → sheet shows 29** | sheet J38 = 29 |

## 6. Expected all-in monthly income, reference settings

Reference settings: Team Trials Class 6, Club B+, CM Third, LoH Platinum 4, daily pack, paid pass, Global, from 2026-07-18.

| Window | Carats | Days | Per 30 days |
|---|---:|---:|---:|
| 60-day (sheet AI342/AI343) | 38,495 | 62 | 18,627 |
| 1-year (sheet AI345/AI346) | 243,595 | 366 | 19,967 |
| Weighted headline (J37: 60d×1, 1y×4) | | | **19,700** |

**Expected all-in monthly range for the reference settings: ≈18,600–20,000 carats (point estimate 19,700) and ≈29 combined scout tickets**, during the Global catch-up window. Of that, timeline handouts contribute ≈8,900/mo (109,170 over the 1-year window) — story events ≈2,830/mo, anniversary cycles ≈2,240/mo, recurring missions ≈1,590/mo, seasonal logins ≈890/mo, other events ≈700/mo, legend races ≈490/mo, uma stories ≈185/mo. The 50-day login + Valentine/White Day component adds ≈170/mo (AU345 = 2,050/yr). These figures exclude the sheet's optional 1,800/mo misc approximation. Post-catch-up the handout component will shrink as event density normalizes to the JP calendar (e.g. 2 instead of 3 anniversary cycles per year); we have not quantified the steady-state rate.

## 7. Conflicts and uncertainty

No component fails the >2x gate between sheet-derived and external values. Residual uncertainties, in decreasing order of materiality:

1. **`campaign` per-event value is an attribution artifact.** The 66,150/yr residual is real money, but spreading it uniformly over uma.moe `campaign` events (≈3,500 each) is a modeling choice, not an observation. Anniversary cycles (≈9,100 each, 3 in the window — an artifact of catch-up compression; steady-state is 2/yr) dominate the residual and have their own payload signal (`anniversaries` array). t-005 should prefer anniversaries + flat monthly residual over a per-campaign constant.
2. **Story event value steps over time** (2,160 now, 2,910 from ~Sep 2027 per the sheet's JP-sourced ledger). A single constant will drift; per-event-id overrides or a dated step is worth it if we care past mid-2027.
3. **Aggregates assume catch-up cadence, and ledger/payload counts differ slightly.** Event counts (16 story events, 13 CM, 5 LoH, ~12 legend races per year) come from the compressed schedule; per-event constants remain valid afterwards but monthly expectations do not. The uma.moe payload shows 14 `story_event` and 10 `legend_race` entries in the same window vs the sheet's 16 and 12 — accruing the pinned per-event values over the payload will land ~10–15% below the reference workbook's handout totals for those two categories.
4. **Sheet ledger is manually curated** from JP history; its individual item dates and labels map JP events onto the projected Global calendar and are frozen as of 2026-07-18.
