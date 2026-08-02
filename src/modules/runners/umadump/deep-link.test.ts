import { describe, expect, it } from 'vitest';
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
  skill_array: [{ skill_id: 100041, level: 2 }],
  memo: '日本語 memo'
};

function encodeText(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('umadump deep-link contract', () => {
  it('round-trips a URL-safe versioned envelope through the existing parser', () => {
    const value = encodeUmadumpDeepLinkValue(JSON.stringify([trainedChara]));

    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    const result = decodeUmadumpDeepLinkValue(value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runners[0]).toMatchObject({
      importNotes: '日本語 memo',
      state: { outfitId: '100401', speed: 987 }
    });
  });

  it.each([
    ['malformed base64', 'not*base64', 'malformed payload'],
    ['invalid JSON', encodeText('{'), 'valid JSON'],
    ['empty parameter', '', 'empty payload'],
    ['empty decoded payload', encodeText(''), 'empty payload'],
    ['unversioned array', encodeText('[]'), 'unsupported format'],
    [
      'empty trained-character array',
      encodeUmadumpDeepLinkValue('[]'),
      'contains no trained characters'
    ],
    ['unsupported version', encodeText(JSON.stringify({ v: 2, data: [] })), 'unsupported version']
  ])('rejects %s with an actionable error', (_name, value, expected) => {
    const result = decodeUmadumpDeepLinkValue(value);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(expected);
    expect(result.error).toContain('import trained_chara_data.json');
  });

  it('rejects values above the documented browser-safe ceiling', () => {
    const result = decodeUmadumpDeepLinkValue('A'.repeat(UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH + 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('too long');
  });
});
