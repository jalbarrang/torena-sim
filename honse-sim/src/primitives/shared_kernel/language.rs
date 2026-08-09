//! The **ubiquitous language** — the racing vocabulary expressed as enums
//! (`Strategy`, `Mood`, `Aptitude`, `Phase`, `Surface`, `Weather`, ...).
//!
//! These value objects are shared by all contexts so the code reads in the
//! domain's own terms. Each enum is `#[repr(i32)]` with the same discriminants
//! the original game data / TypeScript engine use, so they round-trip through
//! serialization and can index the coefficient tables directly.

use serde::{Deserialize, Serialize};

/// A runner's running style. Discriminants match the game (1-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Strategy {
    FrontRunner = 1,
    PaceChaser = 2,
    LateSurger = 3,
    EndCloser = 4,
    Runaway = 5,
}

impl Strategy {
    /// The "base" strategy used for some calculations: Runaway collapses to
    /// Front Runner, everything else is itself.
    pub fn base_strategy(self) -> Strategy {
        match self {
            Strategy::Runaway => Strategy::FrontRunner,
            other => other,
        }
    }

    /// Front-to-back ordering used by post-1.5 position-keep checks.
    ///
    /// Runaway shares Front Runner's rank; larger values are strategies that
    /// should normally run further back.
    pub fn order_rank(self) -> u8 {
        match self {
            Strategy::Runaway | Strategy::FrontRunner => 0,
            Strategy::PaceChaser => 1,
            Strategy::LateSurger => 2,
            Strategy::EndCloser => 3,
        }
    }
}

/// Whether two strategies are considered equivalent for mechanic checks.
///
/// Runaway and Front Runner match each other (Runaway is a Front Runner
/// variant); otherwise equality is exact.
pub fn strategy_matches(a: Strategy, b: Strategy) -> bool {
    if a == b {
        return true;
    }
    matches!(
        (a, b),
        (Strategy::FrontRunner, Strategy::Runaway) | (Strategy::Runaway, Strategy::FrontRunner)
    )
}

/// Motivation / mood, ranging Awful (-2) to Great (+2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Mood {
    Awful = -2,
    Bad = -1,
    Normal = 0,
    Good = 1,
    Great = 2,
}

impl Mood {
    /// Numeric value used in the mood coefficient (`1 + 0.02 * mood`).
    pub fn value(self) -> i32 {
        self as i32
    }
}

/// Aptitude grade S (0, best) through G (7, worst). Used to index proficiency
/// modifier tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Aptitude {
    S = 0,
    A = 1,
    B = 2,
    C = 3,
    D = 4,
    E = 5,
    F = 6,
    G = 7,
}

impl Aptitude {
    /// Index into proficiency tables (0..=7).
    pub fn index(self) -> usize {
        self as usize
    }
}

/// Race phase. Note phase 3 (Last Spurt) shares strategy modifiers with phase 2
/// (Late Race) in most of the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Phase {
    EarlyRace = 0,
    MidRace = 1,
    LateRace = 2,
    LastSpurt = 3,
}

impl Phase {
    /// Index into per-phase coefficient rows (0..=3).
    pub fn index(self) -> usize {
        self as usize
    }
}

/// Track surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Surface {
    Turf = 1,
    Dirt = 2,
}

/// Distance bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum DistanceType {
    Short = 1,
    Mile = 2,
    Mid = 3,
    Long = 4,
}

/// Track orientation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Orientation {
    Clockwise = 1,
    Counterclockwise = 2,
    UnusedOrientation = 3,
    NoTurns = 4,
}

/// Weather condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Weather {
    Sunny = 1,
    Cloudy = 2,
    Rainy = 3,
    Snowy = 4,
}

/// Ground (track) condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum GroundCondition {
    Firm = 1,
    Good = 2,
    Soft = 3,
    Heavy = 4,
}

impl GroundCondition {
    /// Index (1..=4) used by the ground modifier tables.
    pub fn index(self) -> usize {
        self as usize
    }
}

/// Season.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Season {
    Spring = 1,
    Summer = 2,
    Autumn = 3,
    Winter = 4,
    Sakura = 5,
}

/// Time of day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum TimeOfDay {
    NoTime = 0,
    Morning = 1,
    Midday = 2,
    Evening = 3,
    Night = 4,
}

/// Race grade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum Grade {
    G1 = 100,
    G2 = 200,
    G3 = 300,
    Op = 400,
    PreOp = 700,
    Maiden = 800,
    Debut = 900,
    Daily = 999,
}

/// Stat referenced by a course's "set status" bonus list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(i32)]
pub enum ThresholdStat {
    Speed = 1,
    Stamina = 2,
    Power = 3,
    Guts = 4,
    Wit = 5,
}

impl ThresholdStat {
    /// Index (1..=5) used against the `[_, speed, stamina, power, guts, wit]`
    /// stat-value layout the course bonus uses.
    pub fn index(self) -> usize {
        self as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategy_matches_is_symmetric_and_handles_runaway() {
        assert!(strategy_matches(
            Strategy::FrontRunner,
            Strategy::FrontRunner
        ));
        assert!(strategy_matches(Strategy::FrontRunner, Strategy::Runaway));
        assert!(strategy_matches(Strategy::Runaway, Strategy::FrontRunner));
        assert!(!strategy_matches(Strategy::PaceChaser, Strategy::Runaway));
        assert!(!strategy_matches(
            Strategy::FrontRunner,
            Strategy::PaceChaser
        ));
    }

    #[test]
    fn base_strategy_collapses_runaway() {
        assert_eq!(Strategy::Runaway.base_strategy(), Strategy::FrontRunner);
        assert_eq!(Strategy::EndCloser.base_strategy(), Strategy::EndCloser);
    }

    #[test]
    fn order_rank_sorts_front_to_back() {
        assert_eq!(Strategy::Runaway.order_rank(), 0);
        assert_eq!(Strategy::FrontRunner.order_rank(), 0);
        assert_eq!(Strategy::PaceChaser.order_rank(), 1);
        assert_eq!(Strategy::LateSurger.order_rank(), 2);
        assert_eq!(Strategy::EndCloser.order_rank(), 3);
    }

    #[test]
    fn discriminants_match_game_values() {
        assert_eq!(Strategy::Runaway as i32, 5);
        assert_eq!(Mood::Awful.value(), -2);
        assert_eq!(Aptitude::G.index(), 7);
        assert_eq!(Phase::LastSpurt.index(), 3);
        assert_eq!(Grade::Daily as i32, 999);
    }
}
