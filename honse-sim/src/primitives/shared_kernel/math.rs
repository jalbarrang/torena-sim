//! Numeric **value objects**: [`Timer`] and [`CompensatedAccumulator`]
//! (Kahan summation) used for stable per-tick accumulation.

use serde::{Deserialize, Serialize};

/// A simple countdown/elapsed timer.
///
/// Timers are usually initialized to a negative value and advanced each tick;
/// expiry is detected by checking `t >= 0`. Doing it this way (rather than
/// counting down to zero) lets the code that *checks* a duration be separate
/// from the code that *initializes* it with a particular duration.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Timer {
    pub t: f64,
}

impl Timer {
    pub fn new(t: f64) -> Self {
        Timer { t }
    }

    /// Advance the timer by `dt`.
    pub fn advance(&mut self, dt: f64) {
        self.t += dt;
    }
}

/// Kahan (compensated) summation accumulator.
///
/// Tracks a running error term so that adding many small increments to a large
/// running total does not lose precision — important because the simulation
/// accumulates speed/position modifiers over thousands of ticks.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CompensatedAccumulator {
    pub acc: f64,
    pub err: f64,
}

impl CompensatedAccumulator {
    pub fn new(acc: f64) -> Self {
        CompensatedAccumulator { acc, err: 0.0 }
    }

    /// Add `n`, folding the rounding error into `err`. Mirrors the reference
    /// TypeScript implementation exactly.
    pub fn add(&mut self, n: f64) {
        let t = self.acc + n;
        if self.acc.abs() >= n.abs() {
            self.err += self.acc - t + n;
        } else {
            self.err += n - t + self.acc;
        }
        self.acc = t;
    }

    /// The compensated total (`acc + err`).
    pub fn total(&self) -> f64 {
        self.acc + self.err
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timer_advances() {
        let mut timer = Timer::new(-1.0);
        timer.advance(0.5);
        timer.advance(0.5);
        assert_eq!(timer.t, 0.0);
    }

    #[test]
    fn compensated_accumulator_beats_naive_sum() {
        // Adding a tiny value many times to a large base loses precision with a
        // naive f64 sum; the compensated accumulator recovers it.
        let mut acc = CompensatedAccumulator::new(1.0e8);
        let mut naive = 1.0e8_f64;
        for _ in 0..1_000_000 {
            acc.add(1.0e-3);
            naive += 1.0e-3;
        }
        let expected = 1.0e8 + 1_000_000.0 * 1.0e-3;
        let comp_err = (acc.total() - expected).abs();
        let naive_err = (naive - expected).abs();
        assert!(
            comp_err <= naive_err,
            "compensated error {comp_err} should not exceed naive error {naive_err}"
        );
    }
}
