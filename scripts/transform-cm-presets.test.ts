import { describe, expect, it } from 'vitest';
import courseData from '../src/modules/data/json/course_data.json';
import {
  deterministicPresetId,
  findCourseId,
  transformPresets,
  type CourseRow,
  type RawCmPreset
} from './transform-cm-presets';

const courses = courseData as Record<string, CourseRow>;

function sourcePreset(
  id: number,
  track: number,
  distance: number,
  ground: number,
  turn: number
): RawCmPreset {
  return {
    id,
    name: `CM ${id}`,
    start: 1_700_000_000 + id,
    race: {
      condition: 1,
      distance,
      ground,
      season: 1,
      track,
      turn,
      weather: 1
    }
  };
}

describe('Champions Meeting preset generation', () => {
  it('resolves every newly extracted Japanese venue', () => {
    expect(findCourseId(courses, 10104, 1600, 2, 2).courseId).toBe(11402);
    expect(findCourseId(courses, 10105, 1600, 2, 2).courseId).toBe(11502);
    expect(findCourseId(courses, 10201, 2400, 1, 1).courseId).toBe(11203);
  });

  it('generates supported presets and reports unsupported courses', () => {
    const result = transformPresets(
      [
        sourcePreset(26, 10104, 1600, 2, 2),
        sourcePreset(27, 10201, 2400, 1, 1),
        sourcePreset(44, 10203, 2200, 1, 2)
      ],
      courses,
      []
    );

    expect(result.presets.map((preset) => preset.courseId)).toEqual([11402, 11203]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ sourceId: 44, reason: expect.stringContaining('track=10203') })
    ]);
  });

  it('uses stable IDs for new presets', () => {
    expect(deterministicPresetId(26)).toBe('c450e9b8-8255-5a78-992c-6e69f3326d2d');
    expect(deterministicPresetId(26)).toBe(deterministicPresetId(26));
    expect(deterministicPresetId(26)).not.toBe(deterministicPresetId(27));
  });
});
