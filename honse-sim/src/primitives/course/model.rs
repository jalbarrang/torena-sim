//! Course **value objects**: [`Corner`], [`Straight`], [`Slope`], and the
//! composite [`CourseData`] the simulation runs on.
//!
//! These are immutable DTOs deserialized from the TypeScript data layer
//! (`CourseService.getSimCourse`). Field names map to the source `camelCase`
//! JSON via `#[serde(rename_all = "camelCase")]`.

use serde::{Deserialize, Serialize};

use crate::shared_kernel::language::{DistanceType, Orientation, Surface, ThresholdStat};

/// Anything positioned along the track by a `start` offset (in metres). Lets the
/// phase service validate ordering generically over corners/straights/slopes.
pub trait HasStart {
    /// Distance (metres) at which the segment begins.
    fn start(&self) -> f64;
}

/// A curved section of track.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Corner {
    /// Distance (metres) at which the corner begins.
    pub start: f64,
    /// Length of the corner in metres.
    pub length: f64,
}

impl HasStart for Corner {
    fn start(&self) -> f64 {
        self.start
    }
}

/// A straight section of track.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Straight {
    /// Distance (metres) at which the straight begins.
    pub start: f64,
    /// Distance (metres) at which the straight ends.
    pub end: f64,
    /// Opaque "front type" classifier from the source data.
    pub front_type: i32,
}

impl HasStart for Straight {
    fn start(&self) -> f64 {
        self.start
    }
}

/// A sloped (uphill/downhill) section of track.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Slope {
    /// Distance (metres) at which the slope begins.
    pub start: f64,
    /// Length of the slope in metres.
    pub length: f64,
    /// Gradient; positive is uphill, negative is downhill.
    pub slope: f64,
}

impl HasStart for Slope {
    fn start(&self) -> f64 {
        self.start
    }
}

/// Immutable description of a single course the simulation runs on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseData {
    /// Unique course identifier.
    pub course_id: u32,
    /// Identifier of the race track this course belongs to.
    pub race_track_id: u32,
    /// Total race distance in metres.
    pub distance: f64,
    /// Distance bucket (short/mile/mid/long).
    pub distance_type: DistanceType,
    /// Track surface (turf/dirt).
    pub surface: Surface,
    /// Track orientation.
    pub turn: Orientation,

    /// Stats granted a "course set status" bonus on this course.
    pub course_set_status: Vec<ThresholdStat>,

    /// Corner segments, ordered by `start`.
    pub corners: Vec<Corner>,
    /// Straight segments, ordered by `start`.
    pub straights: Vec<Straight>,
    /// Slope segments, ordered by `start`.
    pub slopes: Vec<Slope>,

    /// Maximum number of lanes.
    pub lane_max: f64,
    /// Total course width.
    pub course_width: f64,
    /// Width occupied by a single horse lane.
    pub horse_lane: f64,
    /// Lane-change acceleration.
    pub lane_change_acceleration: f64,
    /// Lane-change acceleration applied per frame.
    pub lane_change_acceleration_per_frame: f64,
    /// Maximum lateral lane distance.
    pub max_lane_distance: f64,
    /// Distance (metres) at which lane movement begins.
    pub move_lane_point: f64,

    /// True when the race is held overseas (master.mdb `race_track.flag_type`).
    /// Defaults to `false` for snapshots that predate the flag.
    #[serde(default)]
    pub is_abroad: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_expose_start() {
        let corner = Corner {
            start: 100.0,
            length: 50.0,
        };
        let straight = Straight {
            start: 200.0,
            end: 400.0,
            front_type: 1,
        };
        let slope = Slope {
            start: 300.0,
            length: 80.0,
            slope: 1.5,
        };
        assert_eq!(corner.start(), 100.0);
        assert_eq!(straight.start(), 200.0);
        assert_eq!(slope.start(), 300.0);
    }

    fn sample_course() -> CourseData {
        CourseData {
            course_id: 10101,
            race_track_id: 10001,
            distance: 2400.0,
            distance_type: DistanceType::Long,
            surface: Surface::Turf,
            turn: Orientation::Clockwise,
            course_set_status: vec![ThresholdStat::Speed, ThresholdStat::Stamina],
            corners: vec![Corner {
                start: 100.0,
                length: 200.0,
            }],
            straights: vec![Straight {
                start: 0.0,
                end: 100.0,
                front_type: 1,
            }],
            slopes: vec![Slope {
                start: 50.0,
                length: 30.0,
                slope: 1.2,
            }],
            lane_max: 10.0,
            course_width: 30.0,
            horse_lane: 1.5,
            lane_change_acceleration: 0.02,
            lane_change_acceleration_per_frame: 0.001,
            max_lane_distance: 5.0,
            move_lane_point: 200.0,
            is_abroad: false,
        }
    }

    #[test]
    fn course_data_round_trips_with_camel_case_fields() {
        let course = sample_course();
        let json = serde_json::to_string(&course).expect("serialize");
        // Field names are emitted in the source `camelCase` form.
        assert!(json.contains("\"courseId\":10101"), "json was: {json}");
        assert!(json.contains("\"laneChangeAccelerationPerFrame\":"));
        assert!(json.contains("\"frontType\":1"));

        let reparsed: CourseData = serde_json::from_str(&json).expect("parse");
        assert_eq!(reparsed, course);
        assert_eq!(reparsed.distance_type, DistanceType::Long);
        assert_eq!(reparsed.course_set_status.len(), 2);
    }
}
