//! Packs a [`RaceReplay`] into the packed little-endian bytes the game writes
//! into a capture (`RaceSimulateData`), so a simulated round can cross the
//! WebAssembly boundary as one `Uint8Array` instead of one JavaScript object per
//! gate per frame.
//!
//! This is the byte-for-byte counterpart of the site's
//! `encodeRaceScenarioBytes` (`src/modules/race-sim/share/race-scenario.ts`),
//! which it replaces on the simulated path. The site decodes the result with
//! `decodeRaceSimData` (`src/modules/race-capture/sim-data.ts`), the same
//! reader a captured race goes through, so a simulated round and a real one
//! keep sharing one decoder.
//!
//! Layout (all integers little-endian):
//!
//! ```text
//! header       i32 headerLength, i32 version
//! race         f32 distanceDiffMax, i32 horseNum, i32 horseFrameSize,
//!              i32 horseResultSize
//! padding 1    i32 size, then `size` bytes
//! frames       i32 frameCount, i32 frameSize, then frameCount blocks of
//!              f32 time followed by horseNum horse frames
//! horse frame  f32 distance, u16 lanePosition, u16 speed, u16 hp,
//!              i8 temptationMode, i8 blockFrontHorseIndex
//! padding 2    i32 size, then `size` bytes
//! results      horseNum blocks of `horseResultSize` bytes
//! horse result i32 finishOrder, f32 finishTime, f32 finishDiffTime,
//!              f32 startDelayTime, u8 gutsOrder, u8 wizOrder,
//!              f32 lastSpurtStartDistance, u8 runningStyle, i32 defeat,
//!              f32 finishTimeRaw
//! padding 3    i32 size, then `size` bytes
//! events       i32 eventCount, then per event: i16 eventSize, f32 frameTime,
//!              i8 type, i8 paramCount, then paramCount i32 params
//! ```
//!
//! The engine already emits every value in the game's own units, so this module
//! owns only the bytes.

use honse_sim::contested::replay::{RaceReplay, ReplayHorseFrame, ReplayHorseResult};

/// Header body length; the header block is this value plus the `i32` that holds
/// it, so the reader can skip the block without knowing its fields.
const HEADER_BODY_SIZE: i32 = 4;
/// The scenario layout version the site's encoder writes.
const SCENARIO_VERSION: i32 = 1;
/// Bytes per horse frame.
const HORSE_FRAME_SIZE: i32 = 12;
/// Bytes per horse result.
const HORSE_RESULT_SIZE: i32 = 31;
/// Bytes of an event after its `i16` size field: `f32 frameTime`, `i8 type`,
/// `i8 paramCount`.
const EVENT_HEADER_SIZE: i32 = 6;
/// Bytes of the race struct.
const RACE_STRUCT_SIZE: i32 = 16;
/// The site's encoder clamps `lanePosition` here (0 at the rail, 9999 one course
/// width out). The engine's own field is a `u16`, so the wider values it can
/// hold must be narrowed to match what the decoder's consumers expect.
const LANE_POSITION_MAX: f64 = 9999.0;
/// A padding block with no bytes in it.
const EMPTY_PADDING: i32 = 0;

/// Append `value` little-endian.
trait WriteLe {
    fn i8(&mut self, value: i8);
    fn i16(&mut self, value: i16);
    fn i32(&mut self, value: i32);
    fn u16(&mut self, value: u16);
    fn u8(&mut self, value: u8);
    fn f32(&mut self, value: f32);
}

impl WriteLe for Vec<u8> {
    fn i8(&mut self, value: i8) {
        self.push(value as u8);
    }
    fn i16(&mut self, value: i16) {
        self.extend_from_slice(&value.to_le_bytes());
    }
    fn i32(&mut self, value: i32) {
        self.extend_from_slice(&value.to_le_bytes());
    }
    fn u16(&mut self, value: u16) {
        self.extend_from_slice(&value.to_le_bytes());
    }
    fn u8(&mut self, value: u8) {
        self.push(value);
    }
    fn f32(&mut self, value: f32) {
        self.extend_from_slice(&value.to_le_bytes());
    }
}

/// Clamp to the range the site's encoder writes for a fixed-width integer field
/// and round half away from zero, like `Math.round`.
fn clamped(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max).round()
}

/// A horse frame padded to [`HORSE_FRAME_SIZE`], for a frame that names fewer
/// gates than the field. After a round ends every frame covers the field, but
/// the packed stride is fixed by the header, so a short frame cannot be written
/// short.
fn horse_or_default(frame: &[ReplayHorseFrame], gate: usize) -> ReplayHorseFrame {
    frame.get(gate).copied().unwrap_or_default()
}

/// Pack `replay` into the capture byte layout.
///
/// `horse_num` is the field size, taken from the result rows (one per gate) —
/// the same source the site's encoder uses.
pub fn encode_replay_bytes(replay: &RaceReplay) -> Vec<u8> {
    let horse_num = replay.results.len() as i32;
    let frame_size = 4 + horse_num * HORSE_FRAME_SIZE;

    let events_size: i32 = replay
        .events
        .iter()
        .map(|event| 2 + EVENT_HEADER_SIZE + event.params.len() as i32 * 4)
        .sum();

    let capacity = 4
        + HEADER_BODY_SIZE as usize
        + RACE_STRUCT_SIZE as usize
        + 4
        + 8
        + replay.frames.len() * frame_size as usize
        + 4
        + replay.results.len() * HORSE_RESULT_SIZE as usize
        + 4
        + 4
        + events_size as usize;
    let mut out: Vec<u8> = Vec::with_capacity(capacity);

    // header
    out.i32(HEADER_BODY_SIZE);
    out.i32(SCENARIO_VERSION);

    // race struct
    out.f32(replay.distance_diff_max);
    out.i32(horse_num);
    out.i32(HORSE_FRAME_SIZE);
    out.i32(HORSE_RESULT_SIZE);

    // padding 1
    out.i32(EMPTY_PADDING);

    // frames
    out.i32(replay.frames.len() as i32);
    out.i32(frame_size);
    for frame in &replay.frames {
        out.f32(frame.time);
        for gate in 0..horse_num as usize {
            let horse = horse_or_default(&frame.horses, gate);
            out.f32(horse.distance);
            out.u16(clamped(f64::from(horse.lane_position), 0.0, LANE_POSITION_MAX) as u16);
            out.u16(horse.speed);
            out.u16(horse.hp);
            out.i8(horse.temptation_mode);
            out.i8(horse.block_front_horse_index);
        }
    }

    // padding 2
    out.i32(EMPTY_PADDING);

    // results
    for result in &replay.results {
        write_result(&mut out, result);
    }

    // padding 3
    out.i32(EMPTY_PADDING);

    // events
    out.i32(replay.events.len() as i32);
    for event in &replay.events {
        let event_size = EVENT_HEADER_SIZE + event.params.len() as i32 * 4;
        out.i16(event_size as i16);
        out.f32(event.frame_time);
        out.i8(event.kind);
        out.i8(event.params.len() as i8);
        for param in &event.params {
            out.i32(*param);
        }
    }

    out
}

fn write_result(out: &mut Vec<u8>, result: &ReplayHorseResult) {
    out.i32(result.finish_order);
    out.f32(result.finish_time);
    out.f32(result.finish_diff_time);
    out.f32(result.start_delay_time);
    out.u8(result.guts_order);
    out.u8(result.wiz_order);
    out.f32(result.last_spurt_start_distance);
    out.u8(result.running_style);
    out.i32(result.defeat);
    out.f32(result.finish_time_raw);
}

#[cfg(test)]
mod tests {
    use super::*;
    use honse_sim::contested::replay::{ReplayEvent, ReplayFrame};

    fn horse(distance: f32) -> ReplayHorseFrame {
        ReplayHorseFrame {
            distance,
            lane_position: 555,
            speed: 2000,
            hp: 500,
            temptation_mode: 0,
            block_front_horse_index: -1,
        }
    }

    fn result_row(finish_order: i32) -> ReplayHorseResult {
        ReplayHorseResult {
            finish_order,
            finish_time: 60.5,
            finish_diff_time: 0.25,
            start_delay_time: 0.1,
            guts_order: 1,
            wiz_order: 2,
            last_spurt_start_distance: 400.0,
            running_style: 2,
            defeat: 0,
            finish_time_raw: 51.27,
        }
    }

    fn sample_replay() -> RaceReplay {
        RaceReplay {
            distance_diff_max: 12.5,
            frames: vec![
                ReplayFrame {
                    time: 0.0,
                    horses: vec![horse(0.0), horse(0.0)],
                },
                ReplayFrame {
                    time: 1.0 / 15.0,
                    horses: vec![horse(1.33), horse(1.2)],
                },
            ],
            results: vec![result_row(0), result_row(1)],
            events: vec![ReplayEvent {
                frame_time: 1.0 / 15.0,
                kind: 3,
                params: vec![1, 201151, -1, 0, 2, 0],
            }],
        }
    }

    /// The packed length is fully determined by the header, so a mismatch here
    /// means a stride or block was written wrong.
    #[test]
    fn packed_length_matches_the_layout() {
        let bytes = encode_replay_bytes(&sample_replay());
        let horse_num = 2;
        let frame_size = 4 + horse_num * HORSE_FRAME_SIZE as usize;
        let expected = 4 + 4 // header
            + 16 // race
            + 4 // padding 1
            + 8 + 2 * frame_size // frames
            + 4 // padding 2
            + horse_num * HORSE_RESULT_SIZE as usize
            + 4 // padding 3
            + 4 + 2 + (6 + 6 * 4); // events: count, size field, body
        assert_eq!(bytes.len(), expected);
    }

    /// Golden bytes produced by the site's reference encoder
    /// (`encodeRaceScenarioBytes` in
    /// `src/modules/race-sim/share/race-scenario.ts`) for [`sample_replay`].
    ///
    /// The site's encoder and this packer must agree byte for byte, because the
    /// decoder only ever sees one of them. `tests/replay-bytes.test.ts` pins the
    /// same bytes on the TypeScript side, so a change to either layout fails one
    /// of the two.
    const GOLDEN: &[u8] = &[
        4, 0, 0, 0, 1, 0, 0, 0, 0, 0, 72, 65, 2, 0, 0, 0, 12, 0, 0, 0, 31, 0, 0, 0, 0, 0, 0, 0, 2,
        0, 0, 0, 28, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43, 2, 208, 7, 244, 1, 0, 255, 0, 0, 0, 0,
        43, 2, 208, 7, 244, 1, 0, 255, 137, 136, 136, 61, 113, 61, 170, 63, 43, 2, 208, 7, 244, 1,
        0, 255, 154, 153, 153, 63, 43, 2, 208, 7, 244, 1, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        114, 66, 0, 0, 128, 62, 205, 204, 204, 61, 1, 2, 0, 0, 200, 67, 2, 0, 0, 0, 0, 123, 20, 77,
        66, 1, 0, 0, 0, 0, 0, 114, 66, 0, 0, 128, 62, 205, 204, 204, 61, 1, 2, 0, 0, 200, 67, 2, 0,
        0, 0, 0, 123, 20, 77, 66, 0, 0, 0, 0, 1, 0, 0, 0, 30, 0, 137, 136, 136, 61, 3, 6, 1, 0, 0,
        0, 191, 17, 3, 0, 255, 255, 255, 255, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
    ];

    #[test]
    fn packed_bytes_match_the_site_encoder() {
        let bytes = encode_replay_bytes(&sample_replay());
        assert_eq!(
            bytes.len(),
            GOLDEN.len(),
            "packed length drifted from the reference encoder"
        );
        for (index, (actual, expected)) in bytes.iter().zip(GOLDEN).enumerate() {
            assert_eq!(
                actual, expected,
                "byte {index} differs from the reference encoder"
            );
        }
    }

    /// A frame that names fewer gates than the result rows still writes one
    /// fixed-stride horse slot per gate, so the reader's stride stays valid.
    #[test]
    fn short_frames_are_padded_to_the_field_size() {
        let mut replay = sample_replay();
        replay.frames[0].horses.truncate(1);
        let bytes = encode_replay_bytes(&replay);
        assert_eq!(bytes.len(), GOLDEN.len());
    }
}
