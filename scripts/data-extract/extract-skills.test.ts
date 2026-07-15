import { describe, expect, it } from 'vitest';
import { parseSkillTags } from './extract-skills';

describe('parseSkillTags', () => {
  it('preserves numeric source order for slash-delimited tags', () => {
    expect(parseSkillTags('401/608')).toEqual([401, 608]);
  });

  it('returns no tags for empty values', () => {
    expect(parseSkillTags('')).toEqual([]);
    expect(parseSkillTags(null)).toEqual([]);
    expect(parseSkillTags(undefined)).toEqual([]);
  });

  it('excludes malformed segments', () => {
    expect(parseSkillTags('401//oops/608.5/-3/999999999999999999999')).toEqual([401]);
  });
});
