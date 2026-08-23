//! [`StaminaLedger`] — the per-runner record of where HP went over a race.
//!
//! The policy owns the ledger and updates it at the two points that move HP:
//! `tick` (the only drain) and `recover` (the only restore). Attribution is
//! therefore complete by construction — no caller can move HP behind its back.
//!
//! Causes are priced **counterfactually**: a cause's amount is the drain that
//! actually happened minus the drain the same tick would have cost with that
//! cause forced inactive. Positive is extra HP burned, negative is HP saved.
//!
//! The parts deliberately do **not** partition the total. When a runner is
//! rushed inside a spot-struggle the two are each priced against a baseline
//! where the other still applies, so their amounts do not sum to the combined
//! excess. See `openspec/changes/surface-stamina-breakdown/design.md`,
//! Decision 2, in the `torena-hub` repository.

use crate::skills::effect::PositionKeepState;
use crate::stamina::policy::RaceStateSlice;

/// A status mechanic that scales a tick's HP drain.
///
/// These are exactly the causes `GameStaminaPolicy::status_modifier` composes.
/// Dueling is absent because the modifier never reads dueling state: in this
/// engine dueling changes speed and position, not HP burn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusCause {
    /// Downhill mode: multiplies drain by `0.4` and adds speed.
    Downhill,
    /// Rushed (temptation): multiplies drain by `1.6`.
    Rushed,
    /// Spot-struggle: multiplies drain and adds speed.
    SpotStruggle,
    /// Position-keep pace-down: multiplies drain by `0.6` and removes speed.
    PaceDown,
    /// Position keeping that raises speed — pace-up, speed-up, overtake, and
    /// pace-up-ex. Touches no consumption multiplier, so its whole cost is the
    /// extra speed it asks for.
    PaceUp,
    /// Dueling. Like pace-up it has no consumption multiplier; it burns HP
    /// purely by making the runner go faster.
    Dueling,
}

impl StatusCause {
    /// Whether `state` has this cause active. Used to skip pricing a cause that
    /// cannot have contributed anything.
    pub(crate) fn is_active_in(self, state: &RaceStateSlice) -> bool {
        match self {
            StatusCause::Downhill => state.is_downhill_mode,
            StatusCause::Rushed => state.is_rushed,
            StatusCause::SpotStruggle => state.in_spot_struggle,
            StatusCause::PaceDown => state.position_keep_state == PositionKeepState::PaceDown,
            // Every position-keep state except pace-down raises speed; the
            // contribution is zero when none is active, so read it directly.
            StatusCause::PaceUp => {
                state.position_keep_state != PositionKeepState::PaceDown
                    && state.speed_contributions.position_keep != 0.0
            }
            StatusCause::Dueling => state.speed_contributions.dueling != 0.0,
        }
    }

    /// The speed this cause is supplying on `state`, in m/s.
    ///
    /// Removing the cause means removing this speed too, which is how a
    /// mechanic with no consumption multiplier still gets priced.
    pub(crate) fn speed_in(self, state: &RaceStateSlice) -> f64 {
        let contributions = &state.speed_contributions;
        match self {
            StatusCause::Downhill => contributions.downhill,
            // Rushed forces position keeping rather than adding speed itself,
            // so charging it for that speed would double-count against pace-up.
            StatusCause::Rushed => 0.0,
            StatusCause::SpotStruggle => contributions.spot_struggle,
            StatusCause::PaceDown | StatusCause::PaceUp => contributions.position_keep,
            StatusCause::Dueling => contributions.dueling,
        }
    }
}

/// Where a runner's HP went over one race.
///
/// All HP figures are absolute, in the same units as `max_hp`, so a consumer can
/// render either raw HP or a percentage of the bar.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct StaminaLedger {
    /// HP the runner would have spent with no status mechanic active at all —
    /// neither their consumption multipliers nor the speed they supplied. The
    /// reference point every cause is measured against.
    pub baseline_spent: f64,
    /// HP actually drained across every tick.
    pub total_spent: f64,
    /// Counterfactual amount attributed to downhill mode. Negative: a saving.
    pub downhill: f64,
    /// Counterfactual amount attributed to being rushed.
    pub rushed: f64,
    /// Counterfactual amount attributed to spot-struggle.
    pub spot_struggle: f64,
    /// Counterfactual amount attributed to pace-down. Negative: a saving.
    pub pace_down: f64,
    /// Counterfactual amount attributed to speed-raising position keeping
    /// (pace-up, speed-up, overtake, pace-up-ex).
    pub pace_up: f64,
    /// Counterfactual amount attributed to dueling.
    pub dueling: f64,
    /// HP restored by recovery effects, measured as the clamped delta so a heal
    /// into a nearly full bar is not overcounted.
    pub total_recovered: f64,
    /// HP removed by effects with a negative modifier — the HP-drain debuffs
    /// that arrive through the same `recover` path.
    pub total_drained_by_effects: f64,
    /// Number of recovery effects that actually restored HP.
    pub recovery_procs: u32,
    /// Max HP for this run, so a consumer can express the rest as a fraction.
    pub max_hp: f64,
}

impl StaminaLedger {
    /// Reset for a fresh race with `max_hp` as the full bar.
    pub(crate) fn reset(&mut self, max_hp: f64) {
        *self = StaminaLedger {
            max_hp,
            ..StaminaLedger::default()
        };
    }

    /// Add one cause's counterfactual amount for a tick.
    pub(crate) fn add_cause(&mut self, cause: StatusCause, amount: f64) {
        match cause {
            StatusCause::Downhill => self.downhill += amount,
            StatusCause::Rushed => self.rushed += amount,
            StatusCause::SpotStruggle => self.spot_struggle += amount,
            StatusCause::PaceDown => self.pace_down += amount,
            StatusCause::PaceUp => self.pace_up += amount,
            StatusCause::Dueling => self.dueling += amount,
        }
    }

    /// Record a recovery effect's clamped HP delta. A negative delta is an
    /// HP-drain debuff and is booked separately rather than as negative
    /// recovery, so neither figure contradicts its own name.
    pub(crate) fn record_recovery(&mut self, delta: f64) {
        if delta > 0.0 {
            self.total_recovered += delta;
            self.recovery_procs += 1;
        } else {
            self.total_drained_by_effects += -delta;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_clears_amounts_and_keeps_max_hp() {
        let mut ledger = StaminaLedger {
            downhill: -12.0,
            recovery_procs: 3,
            ..StaminaLedger::default()
        };

        ledger.reset(900.0);

        assert_eq!(ledger.max_hp, 900.0);
        assert_eq!(ledger.downhill, 0.0);
        assert_eq!(ledger.recovery_procs, 0);
    }

    #[test]
    fn positive_recovery_counts_a_proc_and_negative_books_a_drain() {
        let mut ledger = StaminaLedger::default();

        ledger.record_recovery(120.0);
        ledger.record_recovery(-45.0);

        assert_eq!(ledger.total_recovered, 120.0);
        assert_eq!(ledger.recovery_procs, 1);
        assert_eq!(ledger.total_drained_by_effects, 45.0);
    }

    #[test]
    fn causes_accumulate_independently() {
        let mut ledger = StaminaLedger::default();

        ledger.add_cause(StatusCause::Downhill, -10.0);
        ledger.add_cause(StatusCause::Downhill, -5.0);
        ledger.add_cause(StatusCause::Rushed, 8.0);

        assert_eq!(ledger.downhill, -15.0);
        assert_eq!(ledger.rushed, 8.0);
        assert_eq!(ledger.spot_struggle, 0.0);
    }
}
