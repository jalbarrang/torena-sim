//! The [`Prng`] port and its [`Xoshiro256StarStar`] implementation.
//!
//! Deterministic and seedable. A runner owns several independent sub-streams
//! (rushed, wit, downhill, ...), each spawned from a parent stream via
//! [`Xoshiro256StarStar::spawn_child`].
//!
//! This is a fresh-start PRNG: it does **not** reproduce the legacy `Prando`
//! sequence, so simulation output differs from the original TypeScript engine
//! (an accepted decision — see the plan context).

use rand_core::{RngCore, SeedableRng};
use rand_xoshiro::Xoshiro256StarStar as XoshiroInner;

/// The randomness port used throughout the domain.
///
/// Object-safe so runners can hold heterogeneous `Box<dyn Prng>` sub-streams.
pub trait Prng {
    /// A uniformly distributed 32-bit value.
    fn int32(&mut self) -> u32;

    /// A uniformly distributed `f64` in `[0, 1)` with 53 bits of precision.
    fn random(&mut self) -> f64;

    /// A uniformly distributed integer in `[0, upper)`. Returns `0` when
    /// `upper == 0`.
    fn uniform(&mut self, upper: u32) -> u32;
}

/// xoshiro256** generator wrapping the `rand_xoshiro` implementation.
#[derive(Debug, Clone)]
pub struct Xoshiro256StarStar {
    inner: XoshiroInner,
}

impl Xoshiro256StarStar {
    /// Seed from a 64-bit value. The underlying generator runs SplitMix64 over
    /// the seed, so even small/zero seeds produce a well-distributed state.
    pub fn from_u64_seed(seed: u64) -> Self {
        Xoshiro256StarStar {
            inner: XoshiroInner::seed_from_u64(seed),
        }
    }

    /// Seed from a 32-bit value (the common case when deriving a child stream
    /// from a parent's [`Prng::int32`]).
    pub fn from_u32_seed(seed: u32) -> Self {
        Self::from_u64_seed(seed as u64)
    }

    /// Derive an independent child stream, seeded from this stream's next
    /// 32-bit output. Mirrors the `new Rng(parent.int32())` pattern used to give
    /// each runner sub-system its own deterministic stream.
    pub fn spawn_child(&mut self) -> Xoshiro256StarStar {
        Xoshiro256StarStar::from_u32_seed(self.int32())
    }
}

impl Prng for Xoshiro256StarStar {
    fn int32(&mut self) -> u32 {
        self.inner.next_u32()
    }

    fn random(&mut self) -> f64 {
        // Take the top 53 bits of a 64-bit draw and scale into [0, 1).
        let bits = self.inner.next_u64() >> 11;
        bits as f64 * (1.0 / ((1u64 << 53) as f64))
    }

    fn uniform(&mut self, upper: u32) -> u32 {
        if upper == 0 {
            return 0;
        }
        // Lemire's unbiased bounded integer with rejection.
        let range = upper as u64;
        let mut x = self.int32() as u64;
        let mut m = x * range;
        let mut low = m as u32;
        if (low as u64) < range {
            // Reject the few low results that would bias the distribution.
            let threshold = (range.wrapping_neg() % range) as u32; // (2^32) % range
            while low < threshold {
                x = self.int32() as u64;
                m = x * range;
                low = m as u32;
            }
        }
        (m >> 32) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Xoshiro256StarStar::from_u64_seed(42);
        let mut b = Xoshiro256StarStar::from_u64_seed(42);
        for _ in 0..1000 {
            assert_eq!(a.int32(), b.int32());
        }
    }

    #[test]
    fn different_seeds_differ() {
        let mut a = Xoshiro256StarStar::from_u64_seed(1);
        let mut b = Xoshiro256StarStar::from_u64_seed(2);
        let diffs = (0..100).filter(|_| a.int32() != b.int32()).count();
        assert!(
            diffs > 90,
            "expected mostly-different streams, got {diffs}/100"
        );
    }

    #[test]
    fn random_is_in_unit_interval() {
        let mut rng = Xoshiro256StarStar::from_u64_seed(7);
        for _ in 0..10_000 {
            let r = rng.random();
            assert!((0.0..1.0).contains(&r), "out of range: {r}");
        }
    }

    #[test]
    fn uniform_respects_bounds() {
        let mut rng = Xoshiro256StarStar::from_u64_seed(99);
        for _ in 0..10_000 {
            let v = rng.uniform(9);
            assert!(v < 9);
        }
        assert_eq!(rng.uniform(0), 0);
        // upper == 1 always yields 0.
        for _ in 0..100 {
            assert_eq!(rng.uniform(1), 0);
        }
    }

    #[test]
    fn uniform_is_roughly_balanced() {
        let mut rng = Xoshiro256StarStar::from_u64_seed(123);
        let mut buckets = [0u32; 6];
        let n = 60_000;
        for _ in 0..n {
            buckets[rng.uniform(6) as usize] += 1;
        }
        let expected = n / 6;
        for (i, &count) in buckets.iter().enumerate() {
            let delta = (count as i64 - expected as i64).abs();
            assert!(
                delta < expected as i64 / 5,
                "bucket {i} skew too high: {count} vs {expected}"
            );
        }
    }

    #[test]
    fn spawn_child_is_deterministic_but_distinct() {
        let mut parent_a = Xoshiro256StarStar::from_u64_seed(5);
        let mut parent_b = Xoshiro256StarStar::from_u64_seed(5);
        let mut child_a = parent_a.spawn_child();
        let mut child_b = parent_b.spawn_child();
        // Children from identically-seeded parents match.
        for _ in 0..100 {
            assert_eq!(child_a.int32(), child_b.int32());
        }
        // A second child differs from the first.
        let mut child_a2 = parent_a.spawn_child();
        let diffs = (0..100)
            .filter(|_| child_a.int32() != child_a2.int32())
            .count();
        assert!(diffs > 90);
    }
}
