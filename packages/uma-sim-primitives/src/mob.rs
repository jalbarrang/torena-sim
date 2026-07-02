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

/// A single average mob runner of the given strategy.
fn mob_runner(index: usize, strategy: Strategy) -> CreateRunner {
    CreateRunner {
        outfit_id: "100101".to_owned(),
        name: format!("Mob {index}"),
        mood: Mood::Normal,
        strategy,
        popularity: 0,
        aptitudes: RunnerAptitudes {
            distance: Aptitude::A,
            strategy: Aptitude::A,
            surface: Aptitude::A,
        },
        stats: StatLine {
            speed: 800,
            stamina: 800,
            power: 800,
            guts: 800,
            wit: 800,
        },
        skills: Vec::new(),
        forced_positions: HashMap::new(),
        injected_debuffs: Vec::new(),
        forced_rushed_regions: Vec::new(),
        forced_dueling_regions: Vec::new(),
        forced_spot_struggle_regions: Vec::new(),
        forced_rank: Vec::new(),
    }
}

/// Build mob runners for the given strategy list.
pub fn create_mob_runners(strategies: &[Strategy]) -> Vec<CreateRunner> {
    strategies
        .iter()
        .enumerate()
        .map(|(i, &strategy)| mob_runner(i, strategy))
        .collect()
}

/// The default 9-runner mob field.
pub fn generate_mob_field() -> Vec<CreateRunner> {
    create_mob_runners(&MOB_STRATEGIES)
}

/// Build `count` mob runners by cycling the default strategy mix.
///
/// Unlike [`generate_mob_field`] (fixed 9), this supports arbitrary counts —
/// used to pad a contested field of up to 12 runners.
pub fn generate_mob_runners(count: usize) -> Vec<CreateRunner> {
    let strategies: Vec<Strategy> = MOB_STRATEGIES.iter().copied().cycle().take(count).collect();
    create_mob_runners(&strategies)
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
        let runners = generate_mob_runners(11);
        assert_eq!(runners.len(), 11);
        assert_eq!(runners[9].strategy, MOB_STRATEGIES[0]);
        assert_eq!(runners[10].strategy, MOB_STRATEGIES[1]);

        assert!(generate_mob_runners(0).is_empty());
    }

    #[test]
    fn create_mob_runners_respects_strategies() {
        let runners = create_mob_runners(&[Strategy::Runaway, Strategy::EndCloser]);
        assert_eq!(runners.len(), 2);
        assert_eq!(runners[0].strategy, Strategy::Runaway);
        assert_eq!(runners[1].strategy, Strategy::EndCloser);
    }
}
