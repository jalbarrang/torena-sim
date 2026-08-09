//! Activation-sampling **domain service**.
//!
//! Ports `skills/policies/ActivationSamplePolicy.ts`. The TypeScript version uses
//! Smalltalk-style double dispatch across a family of policy objects; here the
//! whole family collapses into a single [`ActivationSamplePolicy`] enum, and the
//! double dispatch becomes the explicit [`ActivationSamplePolicy::reconcile`]
//! priority lattice.
//!
//! A policy turns the static activation [`RegionList`] (the windows where a
//! skill *could* fire) into concrete trigger [`Region`]s, consuming randomness
//! from a [`Prng`]. Because this port uses a fresh PRNG (no Prando compat) the
//! exact triggers differ from the TypeScript engine, but each sampling algorithm
//! is reproduced faithfully.

use crate::shared_kernel::region::{Region, RegionList};
use crate::shared_kernel::rng::Prng;

/// How a skill's static activation window is sampled into concrete triggers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ActivationSamplePolicy {
    /// Fire at the start of the first region (no randomness).
    Immediate,
    /// Length-weighted random point across all regions.
    Random,
    /// Behaves exactly like [`Random`](Self::Random) but is distinguishable at
    /// parse time so corner-random branch priority is preserved.
    CornerRandom,
    /// Pick a region with equal probability (ignoring length), then a random
    /// point inside it.
    StraightRandom,
    /// Place up to four triggers across the corners and keep the earliest.
    AllCornerRandom,
    /// Erlang-distributed offset (shape `k`, rate `lambda`).
    Erlang { k: u32, lambda: f64 },
    /// Log-normal-distributed offset (`mu`, `sigma`) via Box–Muller.
    LogNormal { mu: f64, sigma: f64 },
    /// Uniformly distributed offset across the combined region range.
    Uniform,
    /// Always fire at a fixed position (overrides the normal conditions).
    Fixed(f64),
}

/// Error returned when two incompatible policies are combined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileError {
    /// `StraightRandom` and `AllCornerRandom` are mutually exclusive.
    StraightVsAllCorner,
}

impl std::fmt::Display for ReconcileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReconcileError::StraightVsAllCorner => {
                write!(f, "cannot reconcile StraightRandom with AllCornerRandom")
            }
        }
    }
}

impl std::error::Error for ReconcileError {}

/// Coarse precedence class used by the reconciliation lattice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Category {
    Immediate,
    Distribution,
    Random,
    Straight,
    AllCorner,
    Fixed,
}

impl ActivationSamplePolicy {
    fn category(&self) -> Category {
        match self {
            ActivationSamplePolicy::Immediate => Category::Immediate,
            ActivationSamplePolicy::Erlang { .. }
            | ActivationSamplePolicy::LogNormal { .. }
            | ActivationSamplePolicy::Uniform => Category::Distribution,
            ActivationSamplePolicy::Random | ActivationSamplePolicy::CornerRandom => {
                Category::Random
            }
            ActivationSamplePolicy::StraightRandom => Category::Straight,
            ActivationSamplePolicy::AllCornerRandom => Category::AllCorner,
            ActivationSamplePolicy::Fixed(_) => Category::Fixed,
        }
    }

    /// Combine two policies that were AND-ed together, returning the dominant
    /// one. Mirrors the TypeScript double-dispatch precedence:
    ///
    /// - `Fixed` dominates everything.
    /// - `Immediate` loses to everything.
    /// - distribution policies lose to `Random`/`Straight`/`AllCorner`.
    /// - `Random`/`CornerRandom` lose to `Straight`/`AllCorner`.
    /// - `Straight` vs `AllCorner` is an error (mutually exclusive).
    pub fn reconcile(self, other: Self) -> Result<Self, ReconcileError> {
        use Category::{AllCorner, Distribution, Immediate, Random, Straight};

        if self.category() == Category::Fixed {
            return Ok(self);
        }
        match other.category() {
            Category::Fixed => Ok(other),
            Immediate => Ok(self),
            Random | Distribution => match self.category() {
                Immediate | Distribution => Ok(other),
                _ => Ok(self),
            },
            Straight => match self.category() {
                Straight => Ok(self),
                AllCorner => Err(ReconcileError::StraightVsAllCorner),
                _ => Ok(other),
            },
            AllCorner => match self.category() {
                Straight => Err(ReconcileError::StraightVsAllCorner),
                _ => Ok(other),
            },
        }
    }

    /// Sample `nsamples` concrete trigger regions from the static activation
    /// `regions`.
    pub fn sample(&self, regions: &RegionList, nsamples: usize, rng: &mut dyn Prng) -> Vec<Region> {
        match self {
            ActivationSamplePolicy::Immediate => regions.0.iter().take(1).copied().collect(),
            ActivationSamplePolicy::Random | ActivationSamplePolicy::CornerRandom => {
                Self::sample_weighted(regions, nsamples, rng)
            }
            ActivationSamplePolicy::StraightRandom => Self::sample_straight(regions, nsamples, rng),
            ActivationSamplePolicy::AllCornerRandom => (0..nsamples)
                .map(|_| Self::place_triggers(regions, rng))
                .collect(),
            ActivationSamplePolicy::Erlang { .. }
            | ActivationSamplePolicy::LogNormal { .. }
            | ActivationSamplePolicy::Uniform => self.sample_distribution(regions, nsamples, rng),
            ActivationSamplePolicy::Fixed(pos) => (0..nsamples)
                .map(|_| Region::new(*pos, *pos + 10.0))
                .collect(),
        }
    }

    /// Length-weighted point sampling (`RandomPolicy` / `CornerRandomPolicy`).
    fn sample_weighted(regions: &RegionList, nsamples: usize, rng: &mut dyn Prng) -> Vec<Region> {
        if regions.0.is_empty() {
            return Vec::new();
        }
        let mut acc = 0.0;
        let weights: Vec<f64> = regions
            .0
            .iter()
            .map(|r| {
                acc += r.len();
                acc
            })
            .collect();

        let mut out = Vec::with_capacity(nsamples);
        for _ in 0..nsamples {
            let threshold = f64::from(rng.uniform(acc as u32));
            let idx = weights
                .iter()
                .position(|&w| w > threshold)
                .unwrap_or(weights.len() - 1);
            let region = regions.0[idx];
            let span = (region.len() - 10.0).max(0.0);
            let pos = region.start + f64::from(rng.uniform(span as u32));
            out.push(Region::new(pos, pos + 10.0));
        }
        out
    }

    /// Equal-weight region then point (`StraightRandomPolicy`).
    fn sample_straight(regions: &RegionList, nsamples: usize, rng: &mut dyn Prng) -> Vec<Region> {
        if regions.0.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(nsamples);
        for _ in 0..nsamples {
            let idx = rng.uniform(regions.0.len() as u32) as usize;
            let region = regions.0[idx];
            let span = (region.len() - 10.0).max(0.0);
            let pos = region.start + f64::from(rng.uniform(span as u32));
            out.push(Region::new(pos, pos + 10.0));
        }
        out
    }

    /// Place up to four triggers across the corners, returning the earliest
    /// (`AllCornerRandomPolicy::placeTriggers`). Returns [`Region::INVALID`] when
    /// no trigger could be placed.
    fn place_triggers(regions: &RegionList, rng: &mut dyn Prng) -> Region {
        let mut candidates = regions.0.clone();
        candidates.sort_by(|a, b| a.start.total_cmp(&b.start));

        let mut first_trigger: Option<f64> = None;
        let mut placed = 0;
        while placed < 4 && !candidates.is_empty() {
            let idx = rng.uniform(candidates.len() as u32) as usize;
            let candidate = candidates[idx];
            let span = (candidate.len() - 10.0).max(0.0);
            let start = candidate.start + f64::from(rng.uniform(span as u32));

            if start + 20.0 <= candidate.end {
                candidates[idx] = Region::new(start + 10.0, candidate.end);
            } else {
                candidates.remove(idx);
            }
            // Everything before this corner is guaranteed earlier in distance.
            candidates.drain(0..idx);

            if first_trigger.is_none() {
                first_trigger = Some(start);
            }
            placed += 1;
        }

        match first_trigger {
            Some(start) => Region::new(start, start + 10.0),
            None => Region::INVALID,
        }
    }

    /// Shared distribution-random sampling (`DistributionRandomPolicy::sample`).
    fn sample_distribution(
        &self,
        regions: &RegionList,
        nsamples: usize,
        rng: &mut dyn Prng,
    ) -> Vec<Region> {
        if regions.0.is_empty() {
            return Vec::new();
        }
        let range: f64 = regions.0.iter().map(Region::len).sum();
        let mut sorted = regions.0.clone();
        sorted.sort_by(|a, b| a.start.total_cmp(&b.start));

        let randoms = self.distribution(range, nsamples, rng);
        let mut out = Vec::with_capacity(nsamples);
        for &random in randoms.iter().take(nsamples) {
            let mut pos = random;
            let mut placed = false;
            for region in &sorted {
                pos += region.start;
                if pos > region.end {
                    pos -= region.end;
                    continue;
                }
                out.push(Region::new(pos, region.end));
                placed = true;
                break;
            }
            if !placed {
                out.push(Region::INVALID);
            }
        }
        out
    }

    /// Per-variant distribution generator (`DistributionRandomPolicy::distribution`).
    fn distribution(&self, upper: f64, nsamples: usize, rng: &mut dyn Prng) -> Vec<f64> {
        match self {
            ActivationSamplePolicy::Uniform => (0..nsamples)
                .map(|_| f64::from(rng.uniform(upper as u32)))
                .collect(),
            ActivationSamplePolicy::LogNormal { mu, sigma } => {
                Self::log_normal_distribution(*mu, *sigma, upper, nsamples, rng)
            }
            ActivationSamplePolicy::Erlang { k, lambda } => {
                Self::erlang_distribution(*k, *lambda, upper, nsamples, rng)
            }
            _ => Vec::new(),
        }
    }

    fn log_normal_distribution(
        mu: f64,
        sigma: f64,
        upper: f64,
        nsamples: usize,
        rng: &mut dyn Prng,
    ) -> Vec<f64> {
        let mut nums = Vec::with_capacity(nsamples + 1);
        let mut min = f64::INFINITY;
        let mut max = 0.0_f64;
        let halfn = nsamples.div_ceil(2);
        for _ in 0..halfn {
            // Box–Muller (polar form): reject points outside the unit circle.
            let (mut x, mut y, mut r2);
            loop {
                x = rng.random() * 2.0 - 1.0;
                y = rng.random() * 2.0 - 1.0;
                r2 = x * x + y * y;
                if r2 != 0.0 && r2 < 1.0 {
                    break;
                }
            }
            let m = (-2.0 * r2.ln() / r2).sqrt() * sigma;
            let a = (x * m + mu).exp();
            let b = (y * m + mu).exp();
            min = min.min(a).min(b);
            max = max.max(a).max(b);
            nums.push(a);
            nums.push(b);
        }
        let range = max - min;
        nums.iter()
            .map(|&n| (upper * (n - min) / range).floor())
            .collect()
    }

    fn erlang_distribution(
        k: u32,
        lambda: f64,
        upper: f64,
        nsamples: usize,
        rng: &mut dyn Prng,
    ) -> Vec<f64> {
        let mut nums = Vec::with_capacity(nsamples);
        let mut min = f64::INFINITY;
        let mut max = 0.0_f64;
        for _ in 0..nsamples {
            let mut u = 1.0;
            for _ in 0..k {
                u *= rng.random();
            }
            let n = -u.ln() / lambda;
            min = min.min(n);
            max = max.max(n);
            nums.push(n);
        }
        if nsamples == 1 {
            let scale = 18.0;
            return nums
                .iter()
                .map(|&n| (upper * (n / scale).min(1.0)).floor())
                .collect();
        }
        let range = max - min;
        nums.iter()
            .map(|&n| (upper * (n - min) / range).floor())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared_kernel::rng::Xoshiro256StarStar;

    fn regions(spans: &[(f64, f64)]) -> RegionList {
        RegionList::from_vec(spans.iter().map(|&(s, e)| Region::new(s, e)).collect())
    }

    #[test]
    fn immediate_returns_first_region_only() {
        let r = regions(&[(0.0, 100.0), (200.0, 300.0)]);
        let mut rng = Xoshiro256StarStar::from_u64_seed(1);
        let out = ActivationSamplePolicy::Immediate.sample(&r, 3, &mut rng);
        assert_eq!(out, vec![Region::new(0.0, 100.0)]);
    }

    #[test]
    fn fixed_always_returns_same_window() {
        let r = regions(&[(0.0, 1000.0)]);
        let mut rng = Xoshiro256StarStar::from_u64_seed(7);
        let out = ActivationSamplePolicy::Fixed(450.0).sample(&r, 2, &mut rng);
        assert_eq!(
            out,
            vec![Region::new(450.0, 460.0), Region::new(450.0, 460.0)]
        );
    }

    #[test]
    fn sampling_is_deterministic_under_fixed_seed() {
        let r = regions(&[(0.0, 500.0), (800.0, 1200.0)]);
        let sample = |policy: ActivationSamplePolicy| {
            let mut rng = Xoshiro256StarStar::from_u64_seed(42);
            policy.sample(&r, 5, &mut rng)
        };
        assert_eq!(
            sample(ActivationSamplePolicy::Random),
            sample(ActivationSamplePolicy::Random)
        );
        assert_eq!(
            sample(ActivationSamplePolicy::Uniform),
            sample(ActivationSamplePolicy::Uniform)
        );
        // Every produced trigger is a 10m window contained within the course.
        for region in sample(ActivationSamplePolicy::Random) {
            assert!((region.len() - 10.0).abs() < 1e-9);
            assert!(region.start >= 0.0);
        }
    }

    #[test]
    fn all_corner_random_keeps_earliest_trigger() {
        let r = regions(&[(0.0, 100.0), (300.0, 400.0), (700.0, 850.0)]);
        let mut rng = Xoshiro256StarStar::from_u64_seed(99);
        let out = ActivationSamplePolicy::AllCornerRandom.sample(&r, 4, &mut rng);
        assert_eq!(out.len(), 4);
        for region in out {
            assert!(region.is_valid());
            assert!((region.len() - 10.0).abs() < 1e-9);
        }
    }

    #[test]
    fn empty_regions_yield_no_samples() {
        let empty = RegionList::new();
        let mut rng = Xoshiro256StarStar::from_u64_seed(3);
        assert!(ActivationSamplePolicy::Random
            .sample(&empty, 4, &mut rng)
            .is_empty());
        assert!(ActivationSamplePolicy::Uniform
            .sample(&empty, 4, &mut rng)
            .is_empty());
        assert!(ActivationSamplePolicy::StraightRandom
            .sample(&empty, 4, &mut rng)
            .is_empty());
    }

    #[test]
    fn reconcile_priority_lattice() {
        use ActivationSamplePolicy as P;
        // Immediate loses to everything.
        assert_eq!(P::Immediate.reconcile(P::Random), Ok(P::Random));
        assert_eq!(P::Random.reconcile(P::Immediate), Ok(P::Random));
        // Distribution loses to Random/Straight/AllCorner, beats Immediate.
        assert_eq!(P::Uniform.reconcile(P::Immediate), Ok(P::Uniform));
        assert_eq!(P::Uniform.reconcile(P::Random), Ok(P::Random));
        assert_eq!(P::Random.reconcile(P::Uniform), Ok(P::Random));
        // Random loses to Straight/AllCorner.
        assert_eq!(
            P::Random.reconcile(P::StraightRandom),
            Ok(P::StraightRandom)
        );
        assert_eq!(
            P::AllCornerRandom.reconcile(P::Random),
            Ok(P::AllCornerRandom)
        );
        // Fixed dominates.
        assert_eq!(
            P::Fixed(10.0).reconcile(P::AllCornerRandom),
            Ok(P::Fixed(10.0))
        );
        assert_eq!(
            P::StraightRandom.reconcile(P::Fixed(5.0)),
            Ok(P::Fixed(5.0))
        );
        // Straight vs AllCorner is an error in both directions.
        assert_eq!(
            P::StraightRandom.reconcile(P::AllCornerRandom),
            Err(ReconcileError::StraightVsAllCorner)
        );
        assert_eq!(
            P::AllCornerRandom.reconcile(P::StraightRandom),
            Err(ReconcileError::StraightVsAllCorner)
        );
    }
}
