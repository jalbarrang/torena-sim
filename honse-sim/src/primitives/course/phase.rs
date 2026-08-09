//! Phase **domain service** — `phase_start` / `phase_end` and ordering
//! validators. Pure functions of distance + phase.
//!
//! Ports the static helpers on the TypeScript `CourseService`. The phase
//! boundaries split the race into quarters-ish: `[0, 1/6, 2/3, 5/6, 1] * d`.

use std::fmt;

use crate::course::model::HasStart;
use crate::shared_kernel::language::{DistanceType, Orientation, Phase, Surface};

/// Distance (metres) at which `phase` begins for a race of `distance` metres.
///
/// Boundaries: `EarlyRace` 0, `MidRace` d/6, `LateRace` 2d/3, `LastSpurt` 5d/6.
pub fn phase_start(distance: f64, phase: Phase) -> f64 {
    match phase {
        Phase::EarlyRace => 0.0,
        Phase::MidRace => distance / 6.0,
        Phase::LateRace => distance * 2.0 / 3.0,
        Phase::LastSpurt => distance * 5.0 / 6.0,
    }
}

/// Distance (metres) at which `phase` ends for a race of `distance` metres.
///
/// Boundaries: `EarlyRace` d/6, `MidRace` 2d/3, `LateRace` 5d/6, `LastSpurt` d.
pub fn phase_end(distance: f64, phase: Phase) -> f64 {
    match phase {
        Phase::EarlyRace => distance / 6.0,
        Phase::MidRace => distance * 2.0 / 3.0,
        Phase::LateRace => distance * 5.0 / 6.0,
        Phase::LastSpurt => distance,
    }
}

/// Whether `segments` are strictly increasing by `start` (no duplicates).
///
/// Mirrors `CourseService.isSortedByStart`: starts must be strictly greater
/// than the previous one (the seed is `-1`, so all real, non-negative starts
/// pass the first comparison). Empty slices are trivially sorted.
pub fn is_sorted_by_start<T: HasStart>(segments: &[T]) -> bool {
    let mut prev = -1.0_f64;
    for segment in segments {
        let start = segment.start();
        if start <= prev {
            return false;
        }
        prev = start;
    }
    true
}

/// Error returned when an integer fails to map onto a domain enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidCourseValue {
    /// The kind of value that failed validation (e.g. `"Phase"`).
    pub kind: &'static str,
    /// The offending integer.
    pub value: i32,
}

impl fmt::Display for InvalidCourseValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} {} is not a valid {}",
            self.kind, self.value, self.kind
        )
    }
}

impl std::error::Error for InvalidCourseValue {}

/// Validate that `phase` is a valid [`Phase`] discriminant (0..=3).
pub fn assert_is_phase(phase: i32) -> Result<Phase, InvalidCourseValue> {
    match phase {
        0 => Ok(Phase::EarlyRace),
        1 => Ok(Phase::MidRace),
        2 => Ok(Phase::LateRace),
        3 => Ok(Phase::LastSpurt),
        value => Err(InvalidCourseValue {
            kind: "Phase",
            value,
        }),
    }
}

/// Validate that `surface` is a valid [`Surface`] discriminant (1..=2).
pub fn assert_is_surface(surface: i32) -> Result<Surface, InvalidCourseValue> {
    match surface {
        1 => Ok(Surface::Turf),
        2 => Ok(Surface::Dirt),
        value => Err(InvalidCourseValue {
            kind: "Surface",
            value,
        }),
    }
}

/// Validate that `distance_type` is a valid [`DistanceType`] discriminant (1..=4).
pub fn assert_is_distance_type(distance_type: i32) -> Result<DistanceType, InvalidCourseValue> {
    match distance_type {
        1 => Ok(DistanceType::Short),
        2 => Ok(DistanceType::Mile),
        3 => Ok(DistanceType::Mid),
        4 => Ok(DistanceType::Long),
        value => Err(InvalidCourseValue {
            kind: "DistanceType",
            value,
        }),
    }
}

/// Validate that `orientation` is a valid [`Orientation`] discriminant (1..=4).
pub fn assert_is_orientation(orientation: i32) -> Result<Orientation, InvalidCourseValue> {
    match orientation {
        1 => Ok(Orientation::Clockwise),
        2 => Ok(Orientation::Counterclockwise),
        3 => Ok(Orientation::UnusedOrientation),
        4 => Ok(Orientation::NoTurns),
        value => Err(InvalidCourseValue {
            kind: "Orientation",
            value,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::course::model::Corner;

    #[test]
    fn phase_boundaries_partition_the_race() {
        let d = 2400.0;
        assert_eq!(phase_start(d, Phase::EarlyRace), 0.0);
        assert_eq!(phase_start(d, Phase::MidRace), 400.0);
        assert_eq!(phase_start(d, Phase::LateRace), 1600.0);
        assert_eq!(phase_start(d, Phase::LastSpurt), 2000.0);

        assert_eq!(phase_end(d, Phase::EarlyRace), 400.0);
        assert_eq!(phase_end(d, Phase::MidRace), 1600.0);
        assert_eq!(phase_end(d, Phase::LateRace), 2000.0);
        assert_eq!(phase_end(d, Phase::LastSpurt), 2400.0);
    }

    #[test]
    fn each_phase_end_is_the_next_phase_start() {
        let d = 1800.0;
        assert_eq!(
            phase_end(d, Phase::EarlyRace),
            phase_start(d, Phase::MidRace)
        );
        assert_eq!(
            phase_end(d, Phase::MidRace),
            phase_start(d, Phase::LateRace)
        );
        assert_eq!(
            phase_end(d, Phase::LateRace),
            phase_start(d, Phase::LastSpurt)
        );
    }

    #[test]
    fn is_sorted_by_start_detects_ordering() {
        let sorted = [
            Corner {
                start: 0.0,
                length: 10.0,
            },
            Corner {
                start: 100.0,
                length: 10.0,
            },
        ];
        let unsorted = [
            Corner {
                start: 100.0,
                length: 10.0,
            },
            Corner {
                start: 50.0,
                length: 10.0,
            },
        ];
        let duplicate = [
            Corner {
                start: 50.0,
                length: 10.0,
            },
            Corner {
                start: 50.0,
                length: 10.0,
            },
        ];
        let empty: [Corner; 0] = [];
        assert!(is_sorted_by_start(&sorted));
        assert!(!is_sorted_by_start(&unsorted));
        assert!(!is_sorted_by_start(&duplicate));
        assert!(is_sorted_by_start(&empty));
    }

    #[test]
    fn validators_accept_valid_and_reject_invalid() {
        assert_eq!(assert_is_phase(3), Ok(Phase::LastSpurt));
        assert_eq!(assert_is_surface(2), Ok(Surface::Dirt));
        assert_eq!(assert_is_distance_type(4), Ok(DistanceType::Long));
        assert_eq!(assert_is_orientation(1), Ok(Orientation::Clockwise));

        assert!(assert_is_phase(4).is_err());
        assert!(assert_is_surface(0).is_err());
        assert!(assert_is_distance_type(9).is_err());
        assert!(assert_is_orientation(5).is_err());
    }
}
