import { describe, expect, it } from 'vitest';
import { BitVector } from '../share/bit-vector';
import {
  decodeUmadumpDeepLinkValue,
  encodeUmadumpDeepLinkValue,
  UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH
} from './deep-link';

const trainedChara = {
  card_id: 100401,
  speed: 987,
  stamina: 445,
  power: 608,
  wiz: 372,
  guts: 364,
  rank_score: 7466,
  proper_ground_turf: 7,
  proper_ground_dirt: 4,
  proper_running_style_nige: 7,
  proper_running_style_senko: 3,
  proper_running_style_sashi: 2,
  proper_running_style_oikomi: 1,
  proper_distance_short: 7,
  proper_distance_mile: 7,
  proper_distance_middle: 7,
  proper_distance_long: 6,
  talent_level: 2,
  running_style: 1,
  skill_array: [
    { skill_id: 100041, level: 2 },
    { skill_id: 200142, level: 1 }
  ],
  memo: 'MemoExample'
};

function encodeHeader(magic: number, version: number, count = 0): string {
  const vector = new BitVector();
  vector.write(magic, 16);
  vector.write(version, 8);
  vector.write(count, 16);
  return vector.toBase64();
}

describe('umadump deep-link BitVector contract', () => {
  it('round-trips the Cygames-shaped import projection through the existing parser', () => {
    const value = encodeUmadumpDeepLinkValue(JSON.stringify([trainedChara]));

    expect(value).toBe('VUQBAAEYgxe2b1MBbC6ba55EGA6VICGGyUYbnEAC01lbW9FeGFtcGxl');
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(value.length).toBe(55);
    const result = decodeUmadumpDeepLinkValue(value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runners[0]).toMatchObject({
      importNotes: 'MemoExample',
      state: {
        outfitId: '100401',
        speed: 987,
        rankScore: 7466,
        star: 2,
        skills: ['100041', '200142'],
        skillLevels: { '100041': 2, '200142': 1 }
      }
    });
  });

  it('preserves UTF-8 memo bytes', () => {
    const value = encodeUmadumpDeepLinkValue(
      JSON.stringify([{ ...trainedChara, memo: '日本語 memo' }])
    );
    const result = decodeUmadumpDeepLinkValue(value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runners[0]?.importNotes).toBe('日本語 memo');
  });

  it.each([
    ['malformed base64url', 'not*base64', 'malformed or truncated'],
    ['empty parameter', '', 'empty payload'],
    ['unsupported format', encodeHeader(0x00_00, 1), 'unsupported format'],
    ['unsupported version', encodeHeader(0x55_44, 2), 'unsupported version'],
    [
      'empty trained-character list',
      encodeUmadumpDeepLinkValue('[]'),
      'contains no trained characters'
    ]
  ])('rejects %s with an actionable error', (_name, value, expected) => {
    const result = decodeUmadumpDeepLinkValue(value);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(expected);
    expect(result.error).toContain('import trained_chara_data.json');
  });

  it('rejects a truncated Veteran payload', () => {
    const value = encodeUmadumpDeepLinkValue(JSON.stringify([trainedChara]));
    const result = decodeUmadumpDeepLinkValue(value.slice(0, -2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('malformed or truncated');
  });

  it('rejects values outside the lossless v1 ranges instead of clamping', () => {
    expect(() =>
      encodeUmadumpDeepLinkValue(JSON.stringify([{ ...trainedChara, speed: 2048 }]))
    ).toThrow('speed must be an integer from 0 to 2047');
  });

  it('rejects values above the documented browser-safe ceiling', () => {
    const result = decodeUmadumpDeepLinkValue('A'.repeat(UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH + 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('too long');
  });
});
