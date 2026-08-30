//! The static condition **catalog** (~110 conditions) plus the helper factories
//! that build them.
//!
//! Ports `parser/conditions/conditions.ts` and the factories from
//! `parser/conditions/utils.ts`. Each entry maps a condition token (e.g.
//! `phase`, `order_rate`, `corner_random`) to a shared [`Condition`] object.
//!
//! Conditions come in three flavours:
//! - pure **static** filters that narrow the activation regions;
//! - static filters that also attach an inline **dynamic** predicate (read
//!   through [`crate::skills::condition::dynamic::RunnerView`]);
//! - `dynamic_or_static`-wrapped conditions that defer to the dynamic registry
//!   (populated by t-009) in normal mode, falling back to a static approximation.

use std::collections::HashSet;
use std::sync::Arc;

use crate::course::phase::{
    assert_is_distance_type, assert_is_phase, is_sorted_by_start, phase_end, phase_start,
};
use crate::shared_kernel::language::{strategy_matches, DistanceType, Phase, Strategy};
use crate::shared_kernel::region::{Region, RegionList};
use crate::skills::activation::ActivationSamplePolicy;
use crate::skills::condition::dynamic::{
    get_dynamic_condition, register_all_dynamic_conditions, DynamicCondition,
};
use crate::skills::condition::operator::CmpKind;
use crate::skills::condition::{
    Condition, ConditionCatalog, ConditionError, ConditionFilterParams, ConditionResolution,
    ConditionResult,
};

type FilterResult = Result<ConditionResult, ConditionError>;
type FilterFn = Arc<dyn for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync>;

/// Skills whose `phase` upper bound is fudged by 10m (see `conditions.ts`).
const FUDGE_PHASE_SKILL_IDS: [&str; 9] = [
    "100591",
    "900591",
    "110261",
    "910261",
    "110191",
    "910191",
    "120451",
    "920451",
    "101502121",
];

const DIRT_GRADE_TRACK_IDS: [u32; 4] = [10101, 10103, 10104, 10105];

// ============================================================
// Small math helpers (ported from spurt-calculator / utils)
// ============================================================

fn calculate_base_speed(distance: f64) -> f64 {
    20.0 - (distance - 2000.0) / 1000.0
}

fn calculate_early_race_average_speed(distance: f64) -> f64 {
    let base_speed = calculate_base_speed(distance);
    let start_speed = 3.0;
    let start_dash_threshold = 0.85 * base_speed;
    (start_speed + start_dash_threshold) / 2.0
}

fn phase_of(arg: i64) -> Result<Phase, ConditionError> {
    assert_is_phase(arg as i32).map_err(|_| ConditionError::Invalid("invalid phase"))
}

fn distance_type_of(arg: i64) -> Result<DistanceType, ConditionError> {
    assert_is_distance_type(arg as i32)
        .map_err(|_| ConditionError::Invalid("invalid distance type"))
}

fn strategy_of(arg: i64) -> Result<Strategy, ConditionError> {
    match arg {
        1 => Ok(Strategy::FrontRunner),
        2 => Ok(Strategy::PaceChaser),
        3 => Ok(Strategy::LateSurger),
        4 => Ok(Strategy::EndCloser),
        5 => Ok(Strategy::Runaway),
        _ => Err(ConditionError::Invalid("invalid strategy")),
    }
}

#[allow(
    clippy::unnecessary_wraps,
    reason = "must match the fallible `FilterResult` signature shared by all filter \
               combinators, even though this identity filter never errors"
)]
fn pass(regions: RegionList) -> FilterResult {
    Ok((regions, None))
}

// ============================================================
// Closure-backed Condition + fluent builder
// ============================================================

fn cmp_index(kind: CmpKind) -> usize {
    match kind {
        CmpKind::Eq => 0,
        CmpKind::Neq => 1,
        CmpKind::Lt => 2,
        CmpKind::Lte => 3,
        CmpKind::Gt => 4,
        CmpKind::Gte => 5,
    }
}

struct ClosureCondition {
    policy: ActivationSamplePolicy,
    filters: [Option<FilterFn>; 6],
}

impl ClosureCondition {
    fn dispatch(&self, kind: CmpKind, params: &ConditionFilterParams<'_>) -> FilterResult {
        match &self.filters[cmp_index(kind)] {
            Some(f) => f(params),
            None => Err(ConditionError::Unsupported),
        }
    }
}

impl Condition for ClosureCondition {
    fn sample_policy(&self) -> ActivationSamplePolicy {
        self.policy
    }
    fn filter_eq(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Eq, p)
    }
    fn filter_neq(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Neq, p)
    }
    fn filter_lt(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Lt, p)
    }
    fn filter_lte(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Lte, p)
    }
    fn filter_gt(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Gt, p)
    }
    fn filter_gte(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.dispatch(CmpKind::Gte, p)
    }
}

/// Fluent builder for a [`ClosureCondition`]. Unspecified comparisons default to
/// [`ConditionError::Unsupported`] (the TS `notSupported`).
struct Cond {
    policy: ActivationSamplePolicy,
    filters: [Option<FilterFn>; 6],
}

impl Cond {
    fn new(policy: ActivationSamplePolicy) -> Self {
        Cond {
            policy,
            filters: Default::default(),
        }
    }

    fn set<F>(mut self, kind: CmpKind, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.filters[cmp_index(kind)] = Some(Arc::new(f));
        self
    }

    fn eq<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Eq, f)
    }
    fn neq<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Neq, f)
    }
    fn lt<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Lt, f)
    }
    fn lte<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Lte, f)
    }
    fn gt<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Gt, f)
    }
    fn gte<F>(self, f: F) -> Self
    where
        F: for<'a> Fn(&ConditionFilterParams<'a>) -> FilterResult + Send + Sync + 'static,
    {
        self.set(CmpKind::Gte, f)
    }

    /// Set every comparison to a no-op (return regions unchanged).
    fn noop_all(mut self) -> Self {
        let noop: FilterFn = Arc::new(|p: &ConditionFilterParams<'_>| pass(p.regions.clone()));
        for slot in &mut self.filters {
            *slot = Some(Arc::clone(&noop));
        }
        self
    }

    fn build(self) -> Arc<dyn Condition> {
        Arc::new(ClosureCondition {
            policy: self.policy,
            filters: self.filters,
        })
    }
}

fn immediate() -> Cond {
    Cond::new(ActivationSamplePolicy::Immediate)
}
fn random() -> Cond {
    Cond::new(ActivationSamplePolicy::Random)
}

// ============================================================
// value_filter family
// ============================================================

/// `value_filter`: an immediate condition comparing a derived numeric value
/// against the argument across all six comparison operators.
fn value_filter<G>(get: G) -> Arc<dyn Condition>
where
    G: for<'a> Fn(&ConditionFilterParams<'a>) -> f64 + Send + Sync + 'static,
{
    let get = Arc::new(get);
    let make = |get: Arc<G>, cmp: fn(f64, f64) -> bool| -> FilterFn {
        Arc::new(move |p: &ConditionFilterParams<'_>| {
            if cmp(get(p), p.arg as f64) {
                pass(p.regions.clone())
            } else {
                pass(RegionList::new())
            }
        })
    };
    Arc::new(ClosureCondition {
        policy: ActivationSamplePolicy::Immediate,
        filters: [
            Some(make(get.clone(), |a, b| a == b)),
            Some(make(get.clone(), |a, b| a != b)),
            Some(make(get.clone(), |a, b| a < b)),
            Some(make(get.clone(), |a, b| a <= b)),
            Some(make(get.clone(), |a, b| a > b)),
            Some(make(get, |a, b| a >= b)),
        ],
    })
}

/// `value_filter_or_noop`: like [`value_filter`], but a `None` value passes the
/// regions through unchanged.
fn value_filter_or_noop<G>(get: G) -> Arc<dyn Condition>
where
    G: for<'a> Fn(&ConditionFilterParams<'a>) -> Option<f64> + Send + Sync + 'static,
{
    let get = Arc::new(get);
    let make = |get: Arc<G>, cmp: fn(f64, f64) -> bool| -> FilterFn {
        Arc::new(move |p: &ConditionFilterParams<'_>| match get(p) {
            None => pass(p.regions.clone()),
            Some(value) => {
                if cmp(value, p.arg as f64) {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            }
        })
    };
    Arc::new(ClosureCondition {
        policy: ActivationSamplePolicy::Immediate,
        filters: [
            Some(make(get.clone(), |a, b| a == b)),
            Some(make(get.clone(), |a, b| a != b)),
            Some(make(get.clone(), |a, b| a < b)),
            Some(make(get.clone(), |a, b| a <= b)),
            Some(make(get.clone(), |a, b| a > b)),
            Some(make(get, |a, b| a >= b)),
        ],
    })
}

// ============================================================
// order_filter family
// ============================================================

const PHASES: [Phase; 4] = [
    Phase::EarlyRace,
    Phase::MidRace,
    Phase::LateRace,
    Phase::LastSpurt,
];

/// How per-phase satisfiability accumulates across the race.
#[derive(Clone, Copy)]
enum OrderScan {
    /// Each phase is judged on its own band.
    PerPhase,
    /// `*_continue` conditions also require every earlier phase to hold
    /// (docs/mechanics/README.md:678).
    Cumulative,
}

/// Narrows `p.regions` to the phase windows whose assumed order band can
/// satisfy the comparison. `band_valid` rejects a malformed band outright;
/// `satisfiable` decides whether a band admits the comparison.
///
/// Contiguous satisfiable phases merge into one window, so an unrestricted set
/// of bands leaves the incoming regions untouched. There is deliberately no
/// "the runner may move up in the last leg" allowance: with a band per phase
/// that belongs in the bands, not in the comparator.
fn order_phase_filter<V, S>(
    p: &ConditionFilterParams<'_>,
    scan: OrderScan,
    band_valid: V,
    satisfiable: S,
) -> FilterResult
where
    V: Fn((u32, u32), u32) -> bool,
    S: Fn((u32, u32), u32) -> bool,
{
    let (Some(bands), Some(num)) = (p.extra.order_ranges, p.extra.num_umas) else {
        return pass(p.regions.clone());
    };
    if !bands.iter().all(|&band| band_valid(band, num)) {
        return Err(ConditionError::Invalid("Invalid order range"));
    }

    let mut sat = bands.map(|band| satisfiable(band, num));
    if let (OrderScan::Cumulative, Some(first_fail)) = (scan, sat.iter().position(|&ok| !ok)) {
        sat[first_fail..].fill(false);
    }

    let mut windows: Vec<Region> = Vec::new();
    for phase in PHASES {
        if !sat[phase.index()] {
            continue;
        }
        let window = Region::new(
            phase_start(p.course.distance, phase),
            phase_end(p.course.distance, phase),
        );
        match windows.last_mut() {
            Some(last) if last.end >= window.start => last.end = window.end,
            _ => windows.push(window),
        }
    }

    pass(p.regions.rmap(|r| {
        windows
            .iter()
            .map(|w| r.intersect(w))
            .collect::<Vec<Region>>()
    }))
}

/// `order_filter`: position-order conditions resolved against `order_ranges`
/// and `num_umas`. `get_pos(arg, num_umas)` yields the comparison position.
fn order_filter<P>(get_pos: P) -> Arc<dyn Condition>
where
    P: Fn(i64, u32) -> f64 + Send + Sync + Copy + 'static,
{
    let any_band = |_: (u32, u32), _: u32| true;
    let lower_band = |(lo, hi): (u32, u32), _: u32| 1 <= lo && lo <= hi;
    let upper_band = |(lo, hi): (u32, u32), num: u32| lo <= hi && hi <= num;
    Cond::new(ActivationSamplePolicy::Immediate)
        .eq(move |p| {
            order_phase_filter(p, OrderScan::PerPhase, any_band, |(lo, hi), num| {
                let pos = get_pos(p.arg, num);
                pos >= f64::from(lo) && pos <= f64::from(hi)
            })
        })
        .neq(move |p| {
            // Satisfiable when the band holds *any* position other than `pos`,
            // matching the rest of the family. Demanding that the band exclude
            // `pos` outright would ask whether the inequality is guaranteed,
            // which rejects every band wide enough to be interesting.
            order_phase_filter(p, OrderScan::PerPhase, any_band, |(lo, hi), num| {
                lo != hi || f64::from(lo) != get_pos(p.arg, num)
            })
        })
        .lt(move |p| {
            order_phase_filter(p, OrderScan::PerPhase, lower_band, |(lo, _), num| {
                f64::from(lo) < get_pos(p.arg, num)
            })
        })
        .lte(move |p| {
            order_phase_filter(p, OrderScan::PerPhase, lower_band, |(lo, _), num| {
                f64::from(lo) <= get_pos(p.arg, num)
            })
        })
        .gt(move |p| {
            order_phase_filter(p, OrderScan::PerPhase, upper_band, |(_, hi), num| {
                get_pos(p.arg, num) < f64::from(hi)
            })
        })
        .gte(move |p| {
            order_phase_filter(p, OrderScan::PerPhase, upper_band, |(_, hi), num| {
                get_pos(p.arg, num) <= f64::from(hi)
            })
        })
        .build()
}

/// `order_in_filter`: `order_rate_inXX_continue` style (filter_eq only).
fn order_in_filter(rate: f64) -> Arc<dyn Condition> {
    immediate()
        .eq(move |p| {
            if p.arg != 1 {
                return Err(ConditionError::Invalid(
                    "must be order_rate_inXX_continue==1",
                ));
            }
            order_phase_filter(
                p,
                OrderScan::Cumulative,
                |(lo, hi), _| 1 <= lo && lo <= hi,
                |(lo, _), num| lo <= (rate * f64::from(num)).round() as u32,
            )
        })
        .build()
}

/// `order_out_filter`: `order_rate_outXX_continue` style (filter_eq only).
fn order_out_filter(rate: f64) -> Arc<dyn Condition> {
    immediate()
        .eq(move |p| {
            if p.arg != 1 {
                return Err(ConditionError::Invalid(
                    "must be order_rate_outXX_continue==1",
                ));
            }
            order_phase_filter(
                p,
                OrderScan::Cumulative,
                |(lo, hi), num| lo <= hi && hi <= num,
                |(_, hi), num| (rate * f64::from(num)).round() as u32 <= hi,
            )
        })
        .build()
}

// ============================================================
// noop / distribution-random factory helpers
// ============================================================

fn noop_immediate() -> Arc<dyn Condition> {
    immediate().noop_all().build()
}

fn noop_erlang(k: u32, lambda: f64) -> Arc<dyn Condition> {
    Cond::new(ActivationSamplePolicy::Erlang { k, lambda })
        .noop_all()
        .build()
}

/// `noop_section_random`: random-policy condition clipping to a 1/24-distance
/// section `[start, end]`.
fn noop_section_random(start: f64, end: f64) -> Arc<dyn Condition> {
    let section = move |p: &ConditionFilterParams<'_>| {
        let bounds = Region::new(
            start * (p.course.distance / 24.0),
            end * (p.course.distance / 24.0),
        );
        pass(p.regions.rmap(move |r| r.intersect(&bounds)))
    };
    random()
        .eq(section)
        .neq(section)
        .lt(section)
        .lte(section)
        .gt(section)
        .gte(section)
        .build()
}

fn shift_regions_forward_by_min_time(p: &ConditionFilterParams<'_>) -> RegionList {
    let min_time = p.arg as f64;
    if min_time <= 0.0 {
        return p.regions.clone();
    }
    let avg_speed = calculate_early_race_average_speed(p.course.distance);
    let min_distance = avg_speed * min_time;
    let mut out = Vec::new();
    for r in &p.regions.0 {
        if r.end <= min_distance {
            continue;
        }
        if r.start < min_distance {
            out.push(Region::new(min_distance, r.end));
        } else {
            out.push(*r);
        }
    }
    RegionList::from_vec(out)
}

// ============================================================
// dynamic_or_static wrapper (the t-009 seam)
// ============================================================

struct DynamicOrStatic {
    inner: Arc<dyn Condition>,
    name: &'static str,
}

impl DynamicOrStatic {
    fn resolve(
        &self,
        kind: CmpKind,
        p: &ConditionFilterParams<'_>,
        fallback: impl Fn(&dyn Condition, &ConditionFilterParams<'_>) -> FilterResult,
    ) -> FilterResult {
        if p.resolution == ConditionResolution::Dynamic {
            if let Some(factory) = get_dynamic_condition(self.name) {
                return Ok((p.regions.clone(), Some(factory(p.arg, kind))));
            }
        }
        fallback(self.inner.as_ref(), p)
    }
}

impl Condition for DynamicOrStatic {
    fn sample_policy(&self) -> ActivationSamplePolicy {
        self.inner.sample_policy()
    }
    fn filter_eq(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Eq, p, |c, p| c.filter_eq(p))
    }
    fn filter_neq(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Neq, p, |c, p| c.filter_neq(p))
    }
    fn filter_lt(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Lt, p, |c, p| c.filter_lt(p))
    }
    fn filter_lte(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Lte, p, |c, p| c.filter_lte(p))
    }
    fn filter_gt(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Gt, p, |c, p| c.filter_gt(p))
    }
    fn filter_gte(&self, p: &ConditionFilterParams<'_>) -> FilterResult {
        self.resolve(CmpKind::Gte, p, |c, p| c.filter_gte(p))
    }
}

fn dynamic_or_static(inner: Arc<dyn Condition>, name: &'static str) -> Arc<dyn Condition> {
    Arc::new(DynamicOrStatic { inner, name })
}

// ============================================================
// Corner helpers
// ============================================================

fn corner_regions_for_arg(p: &ConditionFilterParams<'_>) -> Result<RegionList, ConditionError> {
    let course = p.course;
    let corner_num = p.arg;
    if !is_sorted_by_start(&course.corners) {
        return Err(ConditionError::Invalid(
            "course corners must be sorted by start",
        ));
    }

    if corner_num == 0 {
        let mut non_corners = Vec::new();
        let mut last_end = 0.0;
        for corner in &course.corners {
            non_corners.push(Region::new(last_end, corner.start));
            last_end = corner.start + corner.length;
        }
        if last_end != course.distance {
            non_corners.push(Region::new(last_end, course.distance));
        }
        return Ok(RegionList::from_vec(non_corners));
    }

    let n = course.corners.len() as i64;
    if n + corner_num >= 5 {
        let mut corners = Vec::new();
        let mut idx = n + corner_num - 5;
        while idx >= 0 {
            let corner = course.corners[idx as usize];
            corners.push(Region::new(corner.start, corner.start + corner.length));
            idx -= 4;
        }
        corners.reverse();
        return Ok(RegionList::from_vec(corners));
    }

    Ok(RegionList::new())
}

fn intersect_each(regions: &RegionList, bounds: &[Region]) -> RegionList {
    let bounds = bounds.to_vec();
    regions.rmap(move |r| bounds.iter().map(|b| r.intersect(b)).collect::<Vec<_>>())
}

// ============================================================
// The catalog
// ============================================================

/// Build the full static condition catalog.
pub fn build_catalog() -> ConditionCatalog {
    // Populate the dynamic-condition registry so `dynamic_or_static` conditions
    // resolve to live full-sim predicates under `Dynamic` resolution. Idempotent.
    register_all_dynamic_conditions();

    let mut m: ConditionCatalog = ConditionCatalog::new();
    let mut add = |name: &str, cond: Arc<dyn Condition>| {
        m.insert(name.to_owned(), cond);
    };

    // --- timing / activation-count (inline dynamic) ---
    add(
        "accumulatetime",
        immediate()
            .gte(|p| {
                let t = p.arg as f64;
                let regions = shift_regions_forward_by_min_time(p);
                Ok((
                    regions,
                    Some(DynamicCondition::new(move |r| r.accumulate_time() >= t)),
                ))
            })
            .build(),
    );
    add(
        "activate_count_all",
        immediate()
            .lte(|p| {
                let n = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.skills_activated_count() <= n
                    })),
                ))
            })
            .gte(|p| {
                let n = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.skills_activated_count() >= n
                    })),
                ))
            })
            .build(),
    );
    add("activate_count_start", activate_count_phase(0));
    add("activate_count_middle", activate_count_phase(1));
    add("activate_count_end_after", activate_count_phase(2));
    add(
        "activate_count_heal",
        immediate()
            .gte(|p| {
                let n = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.heals_activated_count() >= n
                    })),
                ))
            })
            .build(),
    );

    // --- corners / course geometry ---
    add(
        "all_corner_random",
        Cond::new(ActivationSamplePolicy::AllCornerRandom)
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be all_corner_random==1"));
                }
                let corners: Vec<Region> = p
                    .course
                    .corners
                    .iter()
                    .map(|c| Region::new(c.start, c.start + c.length))
                    .collect();
                Ok((intersect_each(&p.regions, &corners), None))
            })
            .build(),
    );
    add("always", noop_immediate());

    // --- base stats (base = pre-green) ---
    add(
        "base_power",
        value_filter(|p| f64::from(p.runner.base_stats.power)),
    );
    add(
        "base_speed",
        value_filter(|p| f64::from(p.runner.base_stats.speed)),
    );
    add(
        "base_stamina",
        value_filter(|p| f64::from(p.runner.base_stats.stamina)),
    );
    add(
        "base_guts",
        value_filter(|p| f64::from(p.runner.base_stats.guts)),
    );
    add(
        "base_wiz",
        value_filter(|p| f64::from(p.runner.base_stats.wit)),
    );

    // --- multi-runner delegating (dynamic registry; static fallbacks) ---
    add(
        "bashin_diff_behind",
        dynamic_or_static(noop_erlang(3, 2.0), "bashin_diff_behind"),
    );
    add(
        "bashin_diff_infront",
        dynamic_or_static(noop_erlang(3, 2.0), "bashin_diff_infront"),
    );
    add(
        "behind_near_lane_time",
        dynamic_or_static(noop_erlang(3, 2.0), "behind_near_lane_time"),
    );
    add(
        "behind_near_lane_time_set1",
        dynamic_or_static(noop_erlang(3, 2.0), "behind_near_lane_time_set1"),
    );
    add(
        "blocked_all_continuetime",
        dynamic_or_static(noop_erlang(3, 2.0), "blocked_all_continuetime"),
    );
    add(
        "blocked_front",
        dynamic_or_static(noop_erlang(3, 2.0), "blocked_front"),
    );
    add(
        "blocked_front_continuetime",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Erlang { k: 3, lambda: 2.0 })
                .gte(|p| pass(shift_regions_forward_by_min_time(p)))
                .build(),
            "blocked_front_continuetime",
        ),
    );
    add(
        "blocked_side_continuetime",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Erlang { k: 3, lambda: 2.0 })
                .gte(|p| pass(shift_regions_forward_by_min_time(p)))
                .build(),
            "blocked_side_continuetime",
        ),
    );
    add(
        "change_order_onetime",
        dynamic_or_static(noop_erlang(3, 2.0), "change_order_onetime"),
    );
    add(
        "change_order_up_end_after",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Erlang { k: 3, lambda: 2.0 })
                .gte(|p| {
                    let bounds = Region::new(
                        phase_start(p.course.distance, Phase::LateRace),
                        p.course.distance,
                    );
                    pass(p.regions.rmap(move |r| r.intersect(&bounds)))
                })
                .build(),
            "change_order_up_end_after",
        ),
    );
    add(
        "change_order_up_finalcorner_after",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Erlang { k: 3, lambda: 2.0 })
                .gte(|p| {
                    if !is_sorted_by_start(&p.course.corners) {
                        return Err(ConditionError::Invalid(
                            "course corners must be sorted by start",
                        ));
                    }
                    let Some(final_corner) = p.course.corners.last() else {
                        return pass(RegionList::new());
                    };
                    let bounds = Region::new(final_corner.start, p.course.distance);
                    pass(p.regions.rmap(move |r| r.intersect(&bounds)))
                })
                .build(),
            "change_order_up_finalcorner_after",
        ),
    );
    add(
        "change_order_up_middle",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Erlang { k: 3, lambda: 2.0 })
                .gte(|p| {
                    let bounds = Region::new(
                        phase_start(p.course.distance, Phase::MidRace),
                        phase_end(p.course.distance, Phase::MidRace),
                    );
                    pass(p.regions.rmap(move |r| r.intersect(&bounds)))
                })
                .build(),
            "change_order_up_middle",
        ),
    );
    add(
        "compete_fight_count",
        dynamic_or_static(
            Cond::new(ActivationSamplePolicy::Uniform)
                .gt(|p| {
                    if !is_sorted_by_start(&p.course.straights) {
                        return Err(ConditionError::Invalid(
                            "course straights must be sorted by start",
                        ));
                    }
                    let Some(last_straight) = p.course.straights.last() else {
                        return pass(RegionList::new());
                    };
                    let bounds = Region::new(last_straight.start, last_straight.end);
                    pass(p.regions.rmap(move |r| r.intersect(&bounds)))
                })
                .build(),
            "compete_fight_count",
        ),
    );

    add(
        "corner",
        immediate()
            .eq(|p| {
                let corner_regions = corner_regions_for_arg(p)?;
                Ok((intersect_each(&p.regions, &corner_regions.0), None))
            })
            .neq(|p| {
                let corner_regions = corner_regions_for_arg(p)?;
                pass(p.regions.subtract(&corner_regions))
            })
            .build(),
    );
    add(
        "corner_count",
        value_filter(|p| p.course.corners.len() as f64),
    );
    add(
        "corner_random",
        Cond::new(ActivationSamplePolicy::CornerRandom)
            .eq(|p| {
                if !is_sorted_by_start(&p.course.corners) {
                    return Err(ConditionError::Invalid(
                        "course corners must be sorted by start",
                    ));
                }
                let n = p.course.corners.len() as i64;
                if n + p.arg >= 5 {
                    let corner = p.course.corners[(n + p.arg - 5) as usize];
                    let bounds = Region::new(corner.start, corner.start + corner.length);
                    return pass(p.regions.rmap(move |r| r.intersect(&bounds)));
                }
                pass(RegionList::new())
            })
            .build(),
    );
    add("course_distance", value_filter(|p| p.course.distance));

    // --- distance-difference (dynamic) ---
    add(
        "distance_diff_rate",
        dynamic_or_static(noop_immediate(), "distance_diff_rate"),
    );
    add(
        "distance_diff_top",
        dynamic_or_static(noop_immediate(), "distance_diff_top"),
    );
    add(
        "distance_diff_top_float",
        dynamic_or_static(noop_immediate(), "distance_diff_top_float"),
    );

    add(
        "distance_rate",
        immediate()
            .lte(|p| {
                let bounds = Region::new(0.0, p.course.distance * p.arg as f64 / 100.0);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .gte(|p| {
                let bounds =
                    Region::new(p.course.distance * p.arg as f64 / 100.0, p.course.distance);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "distance_rate_after_random",
        random()
            .eq(|p| {
                let bounds =
                    Region::new(p.course.distance * p.arg as f64 / 100.0, p.course.distance);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "distance_type",
        immediate()
            .eq(|p| {
                let dt = distance_type_of(p.arg)?;
                if p.course.distance_type == dt {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .neq(|p| {
                let dt = distance_type_of(p.arg)?;
                if p.course.distance_type != dt {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .build(),
    );
    add(
        "down_slope_random",
        random()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be down_slope_random==1"));
                }
                let slopes: Vec<Region> = p
                    .course
                    .slopes
                    .iter()
                    .filter(|s| s.slope < 0.0)
                    .map(|s| Region::new(s.start, s.start + s.length))
                    .collect();
                Ok((intersect_each(&p.regions, &slopes), None))
            })
            .build(),
    );

    // --- environment / value filters ---
    add("grade", value_filter(|p| f64::from(p.extra.grade as i32)));
    add(
        "ground_condition",
        value_filter(|p| f64::from(p.extra.ground as i32)),
    );
    add(
        "ground_type",
        value_filter(|p| f64::from(p.course.surface as i32)),
    );
    add(
        "hp_per",
        immediate()
            .lte(|p| {
                let hp = p.arg as f64 / 100.0;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.health_ratio_remaining() <= hp
                    })),
                ))
            })
            .gte(|p| {
                let hp = p.arg as f64 / 100.0;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.health_ratio_remaining() >= hp
                    })),
                ))
            })
            .build(),
    );
    add(
        "infront_near_lane_time",
        dynamic_or_static(noop_erlang(3, 2.0), "infront_near_lane_time"),
    );
    add(
        "is_activate_other_skill_detail",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid(
                        "must be is_activate_other_skill_detail==1",
                    ));
                }
                let skill_id = p.extra.skill_id.as_ref().map(|s| s.as_str().to_owned());
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        skill_id.as_deref().is_some_and(|id| r.has_used_skill(id))
                    })),
                ))
            })
            .build(),
    );
    add(
        "is_basis_distance",
        immediate()
            .eq(|p| {
                if p.arg != 0 && p.arg != 1 {
                    return Err(ConditionError::Invalid(
                        "must be is_basis_distance==0 or ==1",
                    ));
                }
                let basis = (p.course.distance % 400.0).min(1.0);
                if basis != p.arg as f64 {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .build(),
    );
    add(
        "is_badstart",
        immediate()
            .eq(|p| {
                if p.arg != 0 && p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_badstart==0 or ==1"));
                }
                let want_bad = p.arg == 1;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        if want_bad {
                            r.start_delay() > 0.08
                        } else {
                            r.start_delay() <= 0.08
                        }
                    })),
                ))
            })
            .build(),
    );
    add(
        "is_behind_in",
        dynamic_or_static(noop_immediate(), "is_behind_in"),
    );
    add(
        "is_dirtgrade",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_dirtgrade==1"));
                }
                if DIRT_GRADE_TRACK_IDS.contains(&p.course.race_track_id) {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .neq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_dirtgrade!=1"));
                }
                if DIRT_GRADE_TRACK_IDS.contains(&p.course.race_track_id) {
                    pass(RegionList::new())
                } else {
                    pass(p.regions.clone())
                }
            })
            .build(),
    );
    add(
        "is_finalcorner",
        immediate()
            .eq(|p| {
                if p.arg != 0 && p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_finalcorner==0 or ==1"));
                }
                if !is_sorted_by_start(&p.course.corners) {
                    return Err(ConditionError::Invalid(
                        "course corners must be sorted by start",
                    ));
                }
                let Some(final_corner) = p.course.corners.last() else {
                    return pass(RegionList::new());
                };
                let bounds = if p.arg == 1 {
                    Region::new(final_corner.start, p.course.distance)
                } else {
                    Region::new(0.0, final_corner.start)
                };
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "is_finalcorner_laterhalf",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid(
                        "must be is_finalcorner_laterhalf==1",
                    ));
                }
                if !is_sorted_by_start(&p.course.corners) {
                    return Err(ConditionError::Invalid(
                        "course corners must be sorted by start",
                    ));
                }
                let Some(fc) = p.course.corners.last() else {
                    return pass(RegionList::new());
                };
                let bounds = Region::new(
                    (fc.start + fc.start + fc.length) / 2.0,
                    fc.start + fc.length,
                );
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "is_finalcorner_random",
        random()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_finalcorner_random==1"));
                }
                if !is_sorted_by_start(&p.course.corners) {
                    return Err(ConditionError::Invalid(
                        "course corners must be sorted by start",
                    ));
                }
                let Some(fc) = p.course.corners.last() else {
                    return pass(RegionList::new());
                };
                let bounds = Region::new(fc.start, fc.start + fc.length);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "is_hp_empty_onetime",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_hp_empty_onetime==1"));
                }
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| !r.has_remaining_health())),
                ))
            })
            .build(),
    );
    add(
        "is_lastspurt",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_lastspurt==1"));
                }
                let bounds = Region::new(
                    phase_start(p.course.distance, Phase::LateRace),
                    p.course.distance,
                );
                Ok((
                    p.regions.rmap(move |r| r.intersect(&bounds)),
                    Some(DynamicCondition::new(move |r| r.is_last_spurt())),
                ))
            })
            .build(),
    );
    add(
        "is_last_straight",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_last_straight==1"));
                }
                if !is_sorted_by_start(&p.course.straights) {
                    return Err(ConditionError::Invalid(
                        "course straights must be sorted by start",
                    ));
                }
                let Some(last_straight) = p.course.straights.last() else {
                    return pass(RegionList::new());
                };
                let bounds = Region::new(last_straight.start, last_straight.end);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "is_last_straight_onetime",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid(
                        "must be is_last_straight_onetime==1",
                    ));
                }
                if !is_sorted_by_start(&p.course.straights) {
                    return Err(ConditionError::Invalid(
                        "course straights must be sorted by start",
                    ));
                }
                let Some(last_straight) = p.course.straights.last() else {
                    return pass(RegionList::new());
                };
                let trigger = Region::new(last_straight.start, last_straight.start + 10.0);
                pass(p.regions.rmap(move |r| r.intersect(&trigger)))
            })
            .build(),
    );
    add(
        "last_straight_random",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be last_straight_random==1"));
                }
                if !is_sorted_by_start(&p.course.straights) {
                    return Err(ConditionError::Invalid(
                        "course straights must be sorted by start",
                    ));
                }
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .map(|s| Region::new(s.start, s.end))
                    .collect();
                Ok((intersect_each(&p.regions, &straights), None))
            })
            .build(),
    );
    add(
        "is_move_lane",
        dynamic_or_static(noop_erlang(5, 1.0), "is_move_lane"),
    );
    add(
        "is_overtake",
        dynamic_or_static(noop_erlang(1, 2.0), "is_overtake"),
    );
    add(
        "is_surrounded",
        dynamic_or_static(noop_erlang(3, 2.0), "is_surrounded"),
    );
    add(
        "is_temptation",
        dynamic_or_static(noop_immediate(), "is_temptation"),
    );
    add(
        "is_used_skill_id",
        immediate()
            .eq(|p| {
                let id = p.arg.to_string();
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| r.has_used_skill(&id))),
                ))
            })
            .build(),
    );
    add("lane_type", noop_immediate());
    add(
        "lastspurt",
        immediate()
            .eq(|p| {
                let bounds = Region::new(
                    phase_start(p.course.distance, Phase::LateRace),
                    p.course.distance,
                );
                let predicate: DynamicCondition = match p.arg {
                    1 => DynamicCondition::new(|r| {
                        r.is_last_spurt() && r.last_spurt_transition() != -1.0
                    }),
                    2 => DynamicCondition::new(|r| {
                        r.is_last_spurt() && r.last_spurt_transition() == -1.0
                    }),
                    3 => DynamicCondition::new(|r| !r.is_last_spurt()),
                    _ => return Err(ConditionError::Invalid("lastspurt case must be 1-3")),
                };
                Ok((
                    p.regions.rmap(move |r| r.intersect(&bounds)),
                    Some(predicate),
                ))
            })
            .build(),
    );
    add(
        "motivation",
        value_filter(|p| f64::from(p.runner.mood as i32 + 3)),
    );
    add(
        "near_count",
        dynamic_or_static(noop_erlang(3, 2.0), "near_count"),
    );

    // --- order / position (dynamic registry) ---
    add(
        "order",
        dynamic_or_static(order_filter(|pos, _| pos as f64), "order"),
    );
    add(
        "order_rate",
        dynamic_or_static(
            order_filter(|rate, num| (f64::from(num) * (rate as f64 / 100.0)).round()),
            "order_rate",
        ),
    );
    add(
        "order_rate_in20_continue",
        dynamic_or_static(order_in_filter(0.2), "order_rate_in20_continue"),
    );
    add(
        "order_rate_in40_continue",
        dynamic_or_static(order_in_filter(0.4), "order_rate_in40_continue"),
    );
    add(
        "order_rate_in50_continue",
        dynamic_or_static(order_in_filter(0.5), "order_rate_in50_continue"),
    );
    add(
        "order_rate_in80_continue",
        dynamic_or_static(order_in_filter(0.8), "order_rate_in80_continue"),
    );
    add(
        "order_rate_out20_continue",
        dynamic_or_static(order_out_filter(0.2), "order_rate_out20_continue"),
    );
    add(
        "order_rate_out40_continue",
        dynamic_or_static(order_out_filter(0.4), "order_rate_out40_continue"),
    );
    add(
        "order_rate_out50_continue",
        dynamic_or_static(order_out_filter(0.5), "order_rate_out50_continue"),
    );
    add(
        "order_rate_out70_continue",
        dynamic_or_static(order_out_filter(0.7), "order_rate_out70_continue"),
    );
    add(
        "overtake_target_no_order_up_time",
        dynamic_or_static(noop_erlang(3, 2.0), "overtake_target_no_order_up_time"),
    );
    add(
        "overtake_target_time",
        dynamic_or_static(noop_erlang(3, 2.0), "overtake_target_time"),
    );

    // --- phase family ---
    add("phase", build_phase_condition());
    add(
        "phase_corner_random",
        random()
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let ps = phase_start(p.course.distance, phase);
                let pe = phase_end(p.course.distance, phase);
                let corners: Vec<Region> = p
                    .course
                    .corners
                    .iter()
                    .filter(|c| {
                        (c.start >= ps && c.start < pe)
                            || (c.start + c.length >= ps && c.start + c.length < pe)
                    })
                    .map(|c| Region::new(c.start.max(ps), (c.start + c.length).min(pe)))
                    .collect();
                Ok((intersect_each(&p.regions, &corners), None))
            })
            .build(),
    );
    add("phase_firsthalf", phase_fraction_condition(false, 2));
    add("phase_firsthalf_random", phase_fraction_condition(true, 2));
    add("phase_firstquarter", phase_fraction_condition(false, 4));
    add(
        "phase_firstquarter_random",
        phase_fraction_condition(true, 4),
    );
    add(
        "phase_laterhalf_random",
        random()
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let start = phase_start(p.course.distance, phase);
                let end = phase_end(p.course.distance, phase);
                let bounds = Region::new((start + end) / 2.0, end);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "phase_random",
        random()
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let bounds = Region::new(
                    phase_start(p.course.distance, phase),
                    phase_end(p.course.distance, phase),
                );
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "phase_straight_random",
        Cond::new(ActivationSamplePolicy::StraightRandom)
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let phase_bounds = Region::new(
                    phase_start(p.course.distance, phase),
                    phase_end(p.course.distance, phase),
                );
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .map(|s| Region::new(s.start, s.end))
                    .collect();
                let on_straights = intersect_each(&p.regions, &straights);
                pass(on_straights.rmap(move |r| r.intersect(&phase_bounds)))
            })
            .build(),
    );
    add(
        "popularity",
        value_filter_or_noop(|p| {
            // Popularity is static for the race. `0` means unknown (e.g. mob
            // runners) and is treated as "no constraint".
            if p.runner.popularity > 0 {
                Some(p.runner.popularity as f64)
            } else {
                None
            }
        }),
    );
    add(
        "post_number",
        immediate()
            .eq(|p| {
                let post = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| gate_block(r.gate()) == post)),
                ))
            })
            .lte(|p| {
                let post = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| gate_block(r.gate()) <= post)),
                ))
            })
            .gte(|p| {
                let post = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| gate_block(r.gate()) >= post)),
                ))
            })
            .build(),
    );
    add(
        "random_lot",
        immediate()
            .eq(|p| {
                let lot = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| r.random_lot() < lot)),
                ))
            })
            .build(),
    );
    add(
        "remain_distance",
        immediate()
            .eq(|p| {
                let bounds = Region::new(
                    p.course.distance - p.arg as f64,
                    p.course.distance - p.arg as f64 + 1.0,
                );
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .lte(|p| {
                let bounds = Region::new(p.course.distance - p.arg as f64, p.course.distance);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .gte(|p| {
                let bounds = Region::new(0.0, p.course.distance - p.arg as f64);
                pass(p.regions.rmap(move |r| r.intersect(&bounds)))
            })
            .build(),
    );
    add(
        "rotation",
        value_filter(|p| f64::from(p.course.turn as i32)),
    );
    add(
        "running_style",
        immediate()
            .eq(|p| {
                let strategy = strategy_of(p.arg)?;
                if strategy_matches(p.runner.strategy, strategy) {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .build(),
    );
    add(
        "running_style_count_same",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            Some(f64::from(
                counts.get(&p.runner.strategy).copied().unwrap_or(0),
            ))
        }),
    );
    add(
        "running_style_count_same_rate",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            let num = p.extra.num_umas?;
            let same = counts.get(&p.runner.strategy).copied().unwrap_or(0);
            Some(f64::from(same) / f64::from(num))
        }),
    );
    // `running_style_count_<style>_otherself` counts how many *other* runners in
    // the field share that running style (excluding self). The previous
    // implementation only checked whether *self* had the style, so a front
    // runner would only ever satisfy `running_style_count_nige_otherself` (never
    // the senko/sashi/oikomi variants) regardless of the actual field — e.g.
    // "Hesitant Front Runners" was the only Hesitant skill that could ever fire.
    add(
        "running_style_count_nige_otherself",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            let total = counts.get(&Strategy::FrontRunner).copied().unwrap_or(0)
                + counts.get(&Strategy::Runaway).copied().unwrap_or(0);
            let self_in = strategy_matches(p.runner.strategy, Strategy::FrontRunner);
            Some(f64::from(total) - if self_in { 1.0 } else { 0.0 })
        }),
    );
    add(
        "running_style_count_senko_otherself",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            let total = counts.get(&Strategy::PaceChaser).copied().unwrap_or(0);
            let self_in = p.runner.strategy == Strategy::PaceChaser;
            Some(f64::from(total) - if self_in { 1.0 } else { 0.0 })
        }),
    );
    add(
        "running_style_count_sashi_otherself",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            let total = counts.get(&Strategy::LateSurger).copied().unwrap_or(0);
            let self_in = p.runner.strategy == Strategy::LateSurger;
            Some(f64::from(total) - if self_in { 1.0 } else { 0.0 })
        }),
    );
    add(
        "running_style_count_oikomi_otherself",
        value_filter_or_noop(|p| {
            let counts = p.extra.strategy_counts.as_ref()?;
            let total = counts.get(&Strategy::EndCloser).copied().unwrap_or(0);
            let self_in = p.runner.strategy == Strategy::EndCloser;
            Some(f64::from(total) - if self_in { 1.0 } else { 0.0 })
        }),
    );
    add(
        "running_style_equal_popularity_one",
        dynamic_or_static(noop_immediate(), "running_style_equal_popularity_one"),
    );
    add(
        "running_style_temptation_count_nige",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_count_nige",
        ),
    );
    add(
        "running_style_temptation_count_senko",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_count_senko",
        ),
    );
    add(
        "running_style_temptation_count_sashi",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_count_sashi",
        ),
    );
    add(
        "running_style_temptation_count_oikomi",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_count_oikomi",
        ),
    );
    add(
        "running_style_temptation_opponent_count_nige",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_opponent_count_nige",
        ),
    );
    add(
        "running_style_temptation_opponent_count_senko",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_opponent_count_senko",
        ),
    );
    add(
        "running_style_temptation_opponent_count_sashi",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_opponent_count_sashi",
        ),
    );
    add(
        "running_style_temptation_opponent_count_oikomi",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "running_style_temptation_opponent_count_oikomi",
        ),
    );
    add(
        "same_skill_horse_count",
        value_filter_or_noop(|p| {
            let common = p.extra.common_skills.as_ref()?;
            let Some(skill_id) = p.extra.skill_id.as_ref() else {
                return Some(0.0);
            };
            Some(f64::from(
                common.get(skill_id.as_str()).copied().unwrap_or(0),
            ))
        }),
    );
    add("season", value_filter(|p| f64::from(p.extra.season as i32)));
    add(
        "slope",
        immediate()
            .eq(|p| {
                if !(0..=2).contains(&p.arg) {
                    return Err(ConditionError::Invalid("slopeType must be 0, 1, or 2"));
                }
                if !is_sorted_by_start(&p.course.slopes) {
                    return Err(ConditionError::Invalid(
                        "course slopes must be sorted by slope start",
                    ));
                }
                let slope_type = p.arg;
                let mut last_end = 0.0;
                let filtered = p.course.slopes.iter().filter(|s| {
                    (slope_type != 2 && s.slope > 0.0) || (slope_type != 1 && s.slope < 0.0)
                });
                let mut slope_regions: Vec<Region> = if slope_type == 0 {
                    filtered
                        .map(|s| {
                            let r = Region::new(last_end, s.start);
                            last_end = s.start + s.length;
                            r
                        })
                        .collect()
                } else {
                    filtered
                        .map(|s| Region::new(s.start, s.start + s.length))
                        .collect()
                };
                if slope_type == 0 && last_end != p.course.distance {
                    slope_regions.push(Region::new(last_end, p.course.distance));
                }
                Ok((intersect_each(&p.regions, &slope_regions), None))
            })
            .build(),
    );
    add(
        "straight_front_type",
        immediate()
            .eq(|p| {
                if p.arg != 1 && p.arg != 2 {
                    return Err(ConditionError::Invalid("frontType must be 1 or 2"));
                }
                let front_type = p.arg as i32;
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .filter(|s| s.front_type == front_type)
                    .map(|s| Region::new(s.start, s.end))
                    .collect();
                Ok((intersect_each(&p.regions, &straights), None))
            })
            .build(),
    );
    add(
        "straight_random",
        Cond::new(ActivationSamplePolicy::StraightRandom)
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be straight_random==1"));
                }
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .map(|s| Region::new(s.start, s.end))
                    .collect();
                Ok((intersect_each(&p.regions, &straights), None))
            })
            .build(),
    );
    add(
        "temptation_count",
        dynamic_or_static(noop_immediate(), "temptation_count"),
    );
    add(
        "temptation_count_behind",
        dynamic_or_static(noop_section_random(2.0, 9.0), "temptation_count_behind"),
    );
    add(
        "temptation_count_infront",
        dynamic_or_static(noop_section_random(2.0, 9.0), "temptation_count_infront"),
    );
    add(
        "temptation_opponent_count_infront",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "temptation_opponent_count_infront",
        ),
    );
    add(
        "time",
        value_filter(|p| f64::from(p.extra.time_of_day as i32)),
    );
    add(
        "track_id",
        value_filter(|p| f64::from(p.course.race_track_id)),
    );
    add(
        "up_slope_random",
        random()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be up_slope_random==1"));
                }
                let slopes: Vec<Region> = p
                    .course
                    .slopes
                    .iter()
                    .filter(|s| s.slope > 0.0)
                    .map(|s| Region::new(s.start, s.start + s.length))
                    .collect();
                Ok((intersect_each(&p.regions, &slopes), None))
            })
            .build(),
    );
    add(
        "visiblehorse",
        dynamic_or_static(noop_immediate(), "visiblehorse"),
    );
    add(
        "weather",
        value_filter(|p| f64::from(p.extra.weather as i32)),
    );

    add("is_exist_chara_id", noop_immediate());
    add("remain_distance_viewer_id", noop_immediate());

    // --- newly supported condition tokens (parity with TS conditions.ts) ---
    add(
        "is_activate_any_skill",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_activate_any_skill==1"));
                }
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(|r| r.skills_activated_count() > 0)),
                ))
            })
            .build(),
    );
    add(
        "is_activate_heal_skill",
        immediate()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_activate_heal_skill==1"));
                }
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(|r| r.heals_activated_count() > 0)),
                ))
            })
            .build(),
    );
    add(
        "is_used_skill_id_with_detail_one",
        immediate()
            .eq(|p| {
                let id = p.arg.to_string();
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| r.has_used_skill(&id))),
                ))
            })
            .build(),
    );
    add(
        "activate_count_later_half",
        immediate()
            .gte(|p| {
                let n = p.arg;
                Ok((
                    p.regions.clone(),
                    Some(DynamicCondition::new(move |r| {
                        r.skills_activated_half_race(1) >= n
                    })),
                ))
            })
            .build(),
    );
    add(
        "furlong",
        immediate()
            .eq(|p| {
                let n = p.arg as f64;
                let bounds = [Region::new(n * 200.0, (n + 1.0) * 200.0)];
                Ok((intersect_each(&p.regions, &bounds), None))
            })
            .build(),
    );
    add(
        "phase_laterhalf",
        immediate()
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let s = phase_start(p.course.distance, phase);
                let e = phase_end(p.course.distance, phase);
                let bounds = [Region::new((s + e) / 2.0, e)];
                Ok((intersect_each(&p.regions, &bounds), None))
            })
            .build(),
    );
    add(
        "phase_first_half_straight_random",
        Cond::new(ActivationSamplePolicy::StraightRandom)
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let s = phase_start(p.course.distance, phase);
                let e = phase_end(p.course.distance, phase);
                let phase_bounds = [Region::new(s, (s + e) / 2.0)];
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .map(|st| Region::new(st.start, st.end))
                    .collect();
                let in_straights = intersect_each(&p.regions, &straights);
                Ok((intersect_each(&in_straights, &phase_bounds), None))
            })
            .build(),
    );
    add(
        "phase_latter_half_straight_random",
        Cond::new(ActivationSamplePolicy::StraightRandom)
            .eq(|p| {
                let phase = phase_of(p.arg)?;
                let s = phase_start(p.course.distance, phase);
                let e = phase_end(p.course.distance, phase);
                let phase_bounds = [Region::new((s + e) / 2.0, e)];
                let straights: Vec<Region> = p
                    .course
                    .straights
                    .iter()
                    .map(|st| Region::new(st.start, st.end))
                    .collect();
                let in_straights = intersect_each(&p.regions, &straights);
                Ok((intersect_each(&in_straights, &phase_bounds), None))
            })
            .build(),
    );
    add(
        "up_slope_random_later_half",
        random()
            .eq(|p| {
                if p.arg != 1 {
                    return Err(ConditionError::Invalid(
                        "must be up_slope_random_later_half==1",
                    ));
                }
                let later_half = [Region::new(p.course.distance / 2.0, p.course.distance)];
                let slopes: Vec<Region> = p
                    .course
                    .slopes
                    .iter()
                    .filter(|s| s.slope > 0.0)
                    .map(|s| Region::new(s.start, s.start + s.length))
                    .collect();
                let in_slopes = intersect_each(&p.regions, &slopes);
                Ok((intersect_each(&in_slopes, &later_half), None))
            })
            .build(),
    );
    add(
        "temptation_opponent_count_behind",
        dynamic_or_static(
            noop_section_random(2.0, 9.0),
            "temptation_opponent_count_behind",
        ),
    );
    add(
        "near_infront_count",
        dynamic_or_static(noop_erlang(3, 2.0), "near_infront_count"),
    );
    add(
        "is_other_character_activate_advantage_skill",
        dynamic_or_static(
            noop_erlang(3, 2.0),
            "is_other_character_activate_advantage_skill",
        ),
    );
    add(
        "is_abroad",
        immediate()
            .eq(|p| {
                if p.arg != 0 && p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_abroad==0 or ==1"));
                }
                let abroad = i64::from(p.course.is_abroad);
                if abroad == p.arg {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .neq(|p| {
                if p.arg != 0 && p.arg != 1 {
                    return Err(ConditionError::Invalid("must be is_abroad!=0 or !=1"));
                }
                let abroad = i64::from(p.course.is_abroad);
                if abroad != p.arg {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .build(),
    );
    add(
        "is_exist_skill_id",
        immediate()
            .eq(|p| {
                let Some(common) = p.extra.common_skills.as_ref() else {
                    return pass(p.regions.clone());
                };
                let id = p.arg.to_string();
                if common.get(id.as_str()).copied().unwrap_or(0) > 0 {
                    pass(p.regions.clone())
                } else {
                    pass(RegionList::new())
                }
            })
            .build(),
    );

    m
}

/// `gate_block`: collapse a gate number into its post-number block.
fn gate_block(gate: i64) -> i64 {
    if gate < 9 {
        gate
    } else {
        1 + ((24 - gate) % 8)
    }
}

fn activate_count_phase(phase_index: usize) -> Arc<dyn Condition> {
    immediate()
        .gte(move |p| {
            let n = p.arg;
            Ok((
                p.regions.clone(),
                Some(DynamicCondition::new(move |r| {
                    r.skills_activated_in_phase(phase_index) >= n
                })),
            ))
        })
        .build()
}

/// `phase_firsthalf`/`phase_firstquarter` (and their `_random` variants):
/// clip to the leading `1/divisor` slice of a phase.
fn phase_fraction_condition(is_random: bool, divisor: u32) -> Arc<dyn Condition> {
    let policy = if is_random {
        ActivationSamplePolicy::Random
    } else {
        ActivationSamplePolicy::Immediate
    };
    let divisor = f64::from(divisor);
    Cond::new(policy)
        .eq(move |p| {
            let phase = phase_of(p.arg)?;
            let start = phase_start(p.course.distance, phase);
            let end = phase_end(p.course.distance, phase);
            let bounds = Region::new(start, start + (end - start) / divisor);
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .build()
}

fn build_phase_condition() -> Arc<dyn Condition> {
    Cond::new(ActivationSamplePolicy::Immediate)
        .eq(|p| {
            let phase = phase_of(p.arg)?;
            let fudge = p
                .extra
                .skill_id
                .as_ref()
                .is_some_and(|s| FUDGE_PHASE_SKILL_IDS.contains(&s.as_str()));
            let fudge = if fudge { 10.0 } else { 0.0 };
            let bounds = Region::new(
                phase_start(p.course.distance, phase),
                phase_end(p.course.distance, phase) + fudge,
            );
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .lt(|p| {
            let phase = phase_of(p.arg)?;
            if p.arg <= 0 {
                return Err(ConditionError::Invalid("phase == 0"));
            }
            let bounds = Region::new(0.0, phase_start(p.course.distance, phase));
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .lte(|p| {
            let phase = phase_of(p.arg)?;
            let bounds = Region::new(0.0, phase_end(p.course.distance, phase));
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .gt(|p| {
            phase_of(p.arg)?; // validate the phase argument
            if p.arg >= 3 {
                return Err(ConditionError::Invalid("phase > 2"));
            }
            let next = phase_of(p.arg + 1)?;
            let bounds = Region::new(phase_start(p.course.distance, next), p.course.distance);
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .gte(|p| {
            let phase = phase_of(p.arg)?;
            let bounds = Region::new(phase_start(p.course.distance, phase), p.course.distance);
            pass(p.regions.rmap(move |r| r.intersect(&bounds)))
        })
        .build()
}

/// All condition tokens recognized by the engine (for simulatability checks).
pub fn known_condition_tokens() -> HashSet<String> {
    build_catalog().into_keys().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::model::{Corner, CourseData, Slope, Straight};
    use crate::shared_kernel::language::{
        Grade, GroundCondition, Mood, Orientation, Season, Surface, TimeOfDay, Weather,
    };
    use crate::shared_kernel::params::{PhaseOrderRanges, RaceParameters, StatLine};
    use crate::skills::condition::dynamic::RunnerView;
    use crate::skills::condition::language::ConditionParser;
    use crate::skills::condition::{ApplyParams, SkillEvalRunner};

    struct DummyRunner;
    impl RunnerView for DummyRunner {}

    fn course() -> CourseData {
        CourseData {
            course_id: 1,
            race_track_id: 10101,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: vec![],
            corners: vec![
                Corner {
                    start: 600.0,
                    length: 200.0,
                },
                Corner {
                    start: 1000.0,
                    length: 200.0,
                },
                Corner {
                    start: 1700.0,
                    length: 200.0,
                },
                Corner {
                    start: 2000.0,
                    length: 200.0,
                },
            ],
            straights: vec![
                Straight {
                    start: 0.0,
                    end: 600.0,
                    front_type: 1,
                },
                Straight {
                    start: 1200.0,
                    end: 1700.0,
                    front_type: 2,
                },
                Straight {
                    start: 2200.0,
                    end: 2400.0,
                    front_type: 1,
                },
            ],
            slopes: vec![
                Slope {
                    start: 300.0,
                    length: 100.0,
                    slope: 1.0,
                },
                Slope {
                    start: 1500.0,
                    length: 100.0,
                    slope: -1.0,
                },
            ],
            lane_max: 10.0,
            course_width: 30.0,
            horse_lane: 1.5,
            lane_change_acceleration: 0.0,
            lane_change_acceleration_per_frame: 0.0,
            max_lane_distance: 0.0,
            move_lane_point: 0.0,
            is_abroad: false,
        }
    }

    fn runner() -> SkillEvalRunner {
        SkillEvalRunner {
            base_stats: StatLine {
                speed: 1200,
                stamina: 900,
                power: 800,
                guts: 600,
                wit: 700,
            },
            strategy: Strategy::PaceChaser,
            mood: Mood::Great,
            popularity: 0,
        }
    }

    fn params() -> RaceParameters {
        RaceParameters {
            ground: GroundCondition::Firm,
            weather: Weather::Sunny,
            season: Season::Spring,
            time_of_day: TimeOfDay::Midday,
            grade: Grade::G1,
            num_umas: Some(9),
            order_ranges: Some([(1, 9); 4]),
            skill_id: None,
            strategy_counts: None,
            common_skills: None,
        }
    }

    fn whole_course(course: &CourseData) -> RegionList {
        RegionList::from_vec(vec![Region::new(0.0, course.distance)])
    }

    fn apply(condition: &str) -> ConditionResult {
        apply_with(condition, ConditionResolution::Dynamic)
    }

    fn apply_with(condition: &str, resolution: ConditionResolution) -> ConditionResult {
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let op = parser.parse(condition).expect("parse");
        let course = course();
        let runner = runner();
        let extra = params();
        let regions = whole_course(&course);
        op.apply(&ApplyParams {
            regions,
            course: &course,
            runner: &runner,
            extra: &extra,
            resolution,
        })
        .expect("apply")
    }

    fn apply_bands(condition: &str, distance: f64, bands: Option<PhaseOrderRanges>) -> RegionList {
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let op = parser.parse(condition).expect("parse");
        let mut course = course();
        course.distance = distance;
        let runner = runner();
        let mut extra = params();
        extra.order_ranges = bands;
        let regions = whole_course(&course);
        let (out, _) = op
            .apply(&ApplyParams {
                regions,
                course: &course,
                runner: &runner,
                extra: &extra,
                resolution: ConditionResolution::Static,
            })
            .expect("apply");
        out
    }

    #[test]
    fn bands_are_judged_against_the_assumed_field_not_the_vacuum_field() {
        // A vacuum run holds one runner. Judging a nine-runner band against
        // that field rejects it as invalid and kills the whole batch, so the
        // assumed size has to reach the resolver.
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let op = parser.parse("order>=3").expect("parse");
        let mut course = course();
        course.distance = 2000.0;
        let runner = runner();

        let apply = |num_umas: u32| {
            let mut extra = params();
            extra.order_ranges = Some([(1, 1), (1, 1), (3, 4), (1, 1)]);
            extra.num_umas = Some(num_umas);
            op.apply(&ApplyParams {
                regions: whole_course(&course),
                course: &course,
                runner: &runner,
                extra: &extra,
                resolution: ConditionResolution::Static,
            })
        };

        assert!(apply(1).is_err());
        assert!(apply(9).is_ok());
    }

    #[test]
    fn order_neq_asks_whether_the_band_permits_the_inequality() {
        // A band wide enough to hold another position satisfies `order != 3`;
        // only a band pinned to exactly 3rd cannot.
        let wide = apply_bands("order!=3", 2000.0, Some([(1, 9); 4]));
        assert_eq!(wide.0.len(), 1);
        assert_eq!(wide.0[0].start, 0.0);
        assert_eq!(wide.0[0].end, 2000.0);

        let pinned = apply_bands("order!=3", 2000.0, Some([(3, 3); 4]));
        assert!(pinned.0.is_empty());

        let pinned_elsewhere = apply_bands("order!=3", 2000.0, Some([(5, 5); 4]));
        assert_eq!(pinned_elsewhere.0.len(), 1);
    }

    #[test]
    fn order_gte_confines_to_the_phases_whose_band_reaches_it() {
        // Budding Blossom: a front runner sitting 1st all race but 3rd-4th in
        // late race can still satisfy `order>=3`, but only there.
        let regions = apply_bands("order>=3", 2000.0, Some([(1, 1), (1, 1), (3, 4), (1, 1)]));
        assert!(!regions.0.is_empty());
        let (lo, hi) = (
            phase_start(2000.0, Phase::LateRace),
            phase_end(2000.0, Phase::LateRace),
        );
        assert!(
            regions.iter().all(|r| r.start >= lo && r.end <= hi),
            "regions escaped late race: {:?}",
            regions.0
        );
    }

    #[test]
    fn order_gte_is_unconstrained_without_bands() {
        let regions = apply_bands("order>=3", 2000.0, None);
        assert_eq!(regions.0, vec![Region::new(0.0, 2000.0)]);
    }

    #[test]
    fn order_gte_is_empty_when_no_band_reaches_it() {
        let regions = apply_bands("order>=3", 2000.0, Some([(1, 1); 4]));
        assert!(regions.0.is_empty(), "{:?}", regions.0);
    }

    #[test]
    fn order_rate_in_continue_stops_at_the_first_failing_phase() {
        // num_umas 9, so in40 -> top 4. Early race sits 6th, so the condition
        // has already been broken by the time late race gets back inside 4th.
        let regions = apply_bands(
            "order_rate_in40_continue==1",
            2000.0,
            Some([(6, 6), (1, 1), (1, 1), (1, 1)]),
        );
        assert!(regions.0.is_empty(), "{:?}", regions.0);
    }

    #[test]
    fn catalog_covers_known_tokens() {
        let tokens = known_condition_tokens();
        assert!(tokens.contains("phase"));
        assert!(tokens.contains("corner_random"));
        assert!(tokens.contains("order_rate"));
        assert!(tokens.contains("running_style"));
        // The catalog is large; sanity-check the count is in the expected range.
        assert!(tokens.len() > 90, "only {} tokens", tokens.len());
    }

    #[test]
    fn phase_gte_clips_to_late_race_onward() {
        let (regions, cond) = apply("phase>=2");
        assert!(cond.is_none());
        // phase 2 starts at 2/3 of the race = 1600.
        assert_eq!(regions.0, vec![Region::new(1600.0, 2400.0)]);
    }

    #[test]
    fn distance_rate_lte_clips_front() {
        let (regions, _) = apply("distance_rate<=50");
        assert_eq!(regions.0, vec![Region::new(0.0, 1200.0)]);
    }

    #[test]
    fn conjunction_intersects_regions() {
        let (regions, _) = apply("phase>=2&distance_rate<=90");
        // [1600,2400] intersect [0,2160] = [1600,2160].
        assert_eq!(regions.0, vec![Region::new(1600.0, 2160.0)]);
    }

    #[test]
    fn running_style_matches_strategy() {
        let (regions, _) = apply("running_style==2");
        assert_eq!(regions.0, whole_course(&course()).0);
        let (empty, _) = apply("running_style==1");
        assert!(empty.0.is_empty());
    }

    #[test]
    fn popularity_filters_on_static_rank() {
        fn apply_pop(condition: &str, popularity: i64) -> ConditionResult {
            let catalog = build_catalog();
            let parser = ConditionParser::new(&catalog);
            let op = parser.parse(condition).expect("parse");
            let course = course();
            let mut runner = runner();
            runner.popularity = popularity;
            let extra = params();
            let regions = whole_course(&course);
            op.apply(&ApplyParams {
                regions,
                course: &course,
                runner: &runner,
                extra: &extra,
                resolution: ConditionResolution::Dynamic,
            })
            .expect("apply")
        }

        // "Target in sight"-style favourite check: passes for #1, empties otherwise.
        let (favourite, _) = apply_pop("popularity==1", 1);
        assert_eq!(favourite.0, whole_course(&course()).0);
        let (not_favourite, _) = apply_pop("popularity==1", 3);
        assert!(not_favourite.0.is_empty());

        // "Long-shot"-style underdog check (popularity>=6).
        let (underdog, _) = apply_pop("popularity>=6", 7);
        assert_eq!(underdog.0, whole_course(&course()).0);
        let (not_underdog, _) = apply_pop("popularity>=6", 2);
        assert!(not_underdog.0.is_empty());

        // Unknown popularity (0, e.g. mob runners) is treated as no constraint.
        let (unknown, _) = apply_pop("popularity<=3", 0);
        assert_eq!(unknown.0, whole_course(&course()).0);
    }

    #[test]
    fn distance_type_filters_course() {
        let (regions, _) = apply("distance_type==4");
        assert_eq!(regions.0, whole_course(&course()).0);
        let (empty, _) = apply("distance_type==1");
        assert!(empty.0.is_empty());
    }

    #[test]
    fn inline_dynamic_condition_is_attached() {
        let (_, cond) = apply("accumulatetime>=20");
        // The default RunnerView reports accumulate_time = 0, so 0 >= 20 is false.
        assert!(!cond.expect("dynamic condition").eval(&DummyRunner));
    }

    #[test]
    fn is_dirtgrade_uses_track_id() {
        // course track id is 10101 (a dirt-grade track).
        let (regions, _) = apply("is_dirtgrade==1");
        assert_eq!(regions.0, whole_course(&course()).0);
    }

    #[test]
    fn order_rate_passes_when_in_range_static_fallback() {
        // In compare mode the static `order_filter` is used: bands (1,9) in every
        // num_umas 9; order_rate<=50 -> pos=round(9*0.5)=5, within [1,9] for the
        // <= leg, so the whole course passes and no dynamic gate is attached.
        let (regions, cond) = apply_with("order_rate<=50", ConditionResolution::Static);
        assert!(cond.is_none());
        assert_eq!(regions.0, whole_course(&course()).0);
    }

    fn apply_otherself(
        condition: &str,
        self_strategy: Strategy,
        counts: &[(Strategy, u32)],
    ) -> bool {
        use std::collections::HashMap;
        let catalog = build_catalog();
        let parser = ConditionParser::new(&catalog);
        let op = parser.parse(condition).expect("parse");
        let course = course();
        let mut runner = runner();
        runner.strategy = self_strategy;
        let mut extra = params();
        let map: HashMap<Strategy, u32> = counts.iter().copied().collect();
        extra.strategy_counts = Some(map);
        let regions = whole_course(&course);
        let (out, _) = op
            .apply(&ApplyParams {
                regions,
                course: &course,
                runner: &runner,
                extra: &extra,
                resolution: ConditionResolution::Dynamic,
            })
            .expect("apply");
        !out.0.is_empty()
    }

    #[test]
    fn running_style_count_otherself_counts_the_field_excluding_self() {
        // Field: 2 front runners + 1 runaway (all "nige") + 3 pace chasers.
        let field = [
            (Strategy::FrontRunner, 2),
            (Strategy::Runaway, 1),
            (Strategy::PaceChaser, 3),
        ];

        // A front runner sees the *other* 2 nige runners (3 total - self).
        assert!(apply_otherself(
            "running_style_count_nige_otherself>=1",
            Strategy::FrontRunner,
            &field
        ));
        // ...and the 3 pace chasers (it is not one of them).
        assert!(apply_otherself(
            "running_style_count_senko_otherself>=3",
            Strategy::FrontRunner,
            &field
        ));
        // No late surgers in the field -> the sashi variant must not fire.
        assert!(!apply_otherself(
            "running_style_count_sashi_otherself>=1",
            Strategy::FrontRunner,
            &field
        ));

        // The lone front runner in a field is the only nige -> 0 others.
        assert!(!apply_otherself(
            "running_style_count_nige_otherself>=1",
            Strategy::FrontRunner,
            &[(Strategy::FrontRunner, 1), (Strategy::PaceChaser, 8)]
        ));
    }

    #[test]
    fn order_rate_resolves_to_dynamic_in_normal_mode() {
        // In normal mode the registered full-sim predicate is attached: the
        // regions pass through unchanged and a dynamic condition is produced.
        let (regions, cond) = apply_with("order_rate<=50", ConditionResolution::Dynamic);
        assert_eq!(regions.0, whole_course(&course()).0);
        let cond = cond.expect("dynamic condition in normal mode");
        // DummyRunner has no order -> predicate is false.
        assert!(!cond.eval(&DummyRunner));
    }
}
