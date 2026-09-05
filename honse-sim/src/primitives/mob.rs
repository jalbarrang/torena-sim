//! Mob (NPC) field generation.
//!
//! Port of `race-sim/mob-factory.ts`: builds a default 9-runner field of
//! "average" NPCs (all-800 stats, A aptitudes, Normal mood) with a representative
//! strategy distribution, used to fill a race around the runner under test.

use std::collections::HashMap;

use crate::runner::lifecycle::{CreateRunner, RunnerAptitudes};
use crate::shared_kernel::language::{Aptitude, Mood, Strategy};
use crate::shared_kernel::params::StatLine;

/// The default mob strategy distribution (9 runners).
const MOB_STRATEGIES: [Strategy; 9] = [
    Strategy::Runaway,
    Strategy::FrontRunner,
    Strategy::FrontRunner,
    Strategy::PaceChaser,
    Strategy::PaceChaser,
    Strategy::PaceChaser,
    Strategy::LateSurger,
    Strategy::LateSurger,
    Strategy::EndCloser,
];

/// The flat stat value used for race-sim's default mob field.
pub const DEFAULT_MOB_STATS: i32 = 800;

/// The flat stat value used for contested-compare fill mobs.
pub const CONTESTED_FILL_MOB_STATS: i32 = 600;

/// A single average mob runner of the given strategy with flat `stats`.
fn mob_runner(index: usize, strategy: Strategy, stats: i32) -> CreateRunner {
    CreateRunner {
        outfit_id: "100101".to_owned(),
        name: format!("Mob {index}"),
        mood: Mood::Normal,
        strategy,
        popularity: 0,
        team: None,
        aptitudes: RunnerAptitudes {
            distance: Aptitude::A,
            strategy: Aptitude::A,
            surface: Aptitude::A,
        },
        stats: StatLine {
            speed: stats,
            stamina: stats,
            power: stats,
            guts: stats,
            wit: stats,
        },
        skills: Vec::new(),
        forced_positions: HashMap::new(),
        injected_debuffs: Vec::new(),
        forced_rushed_regions: Vec::new(),
        forced_dueling_regions: Vec::new(),
        forced_spot_struggle_regions: Vec::new(),
        forced_downhill_regions: Vec::new(),
        forced_rank: Vec::new(),
        gate: None,
        forced_start_delay: None,
        forced_last_spurt_distance: None,
    }
}

/// Build mob runners for the given strategy list at the default (800) stats.
pub fn create_mob_runners(strategies: &[Strategy]) -> Vec<CreateRunner> {
    strategies
        .iter()
        .enumerate()
        .map(|(i, &strategy)| mob_runner(i, strategy, DEFAULT_MOB_STATS))
        .collect()
}

/// The default 9-runner mob field (race-sim; 800 flat stats).
pub fn generate_mob_field() -> Vec<CreateRunner> {
    create_mob_runners(&MOB_STRATEGIES)
}

/// Build `count` mob runners with flat `stats`, cycling the default strategy
/// mix.
///
/// Unlike [`generate_mob_field`] (fixed 9 at 800), this supports arbitrary
/// counts and stat levels — used to pad a contested field of up to 12 runners
/// (default [`CONTESTED_FILL_MOB_STATS`]).
pub fn generate_mob_runners(count: usize, stats: i32) -> Vec<CreateRunner> {
    MOB_STRATEGIES
        .iter()
        .copied()
        .cycle()
        .take(count)
        .enumerate()
        .map(|(i, strategy)| mob_runner(i, strategy, stats))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_nine_average_runners() {
        let field = generate_mob_field();
        assert_eq!(field.len(), 9);
        assert!(field.iter().all(|r| r.stats.speed == 800));
        assert!(field.iter().all(|r| r.mood == Mood::Normal));
    }

    #[test]
    fn generate_mob_runners_cycles_strategy_mix() {
        let runners = generate_mob_runners(11, CONTESTED_FILL_MOB_STATS);
        assert_eq!(runners.len(), 11);
        assert_eq!(runners[9].strategy, MOB_STRATEGIES[0]);
        assert_eq!(runners[10].strategy, MOB_STRATEGIES[1]);
        assert!(runners
            .iter()
            .all(|r| r.stats.speed == 600 && r.stats.guts == 600));

        assert!(generate_mob_runners(0, CONTESTED_FILL_MOB_STATS).is_empty());
    }

    #[test]
    fn create_mob_runners_respects_strategies() {
        let runners = create_mob_runners(&[Strategy::Runaway, Strategy::EndCloser]);
        assert_eq!(runners.len(), 2);
        assert_eq!(runners[0].strategy, Strategy::Runaway);
        assert_eq!(runners[1].strategy, Strategy::EndCloser);
    }
}
