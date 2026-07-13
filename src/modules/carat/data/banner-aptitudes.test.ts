import { describe, expect, it } from 'vitest';
import { bannerAptitudes } from './banner-aptitudes';
import type { TimelineEvent } from './timeline-types';

function characterEvent(pickupCardIds: number[]): TimelineEvent {
  return {
    id: 'test-banner',
    card_type: 'character',
    type: 'character_banner',
    pickup_card_ids: pickupCardIds
  };
}

describe('bannerAptitudes', () => {
  it('derives main (A) and secondary (B) aptitudes for Special Week', () => {
    // Special Week (100101): A G F C A A G A A C
    const result = bannerAptitudes(characterEvent([100101]));
    expect(result).not.toBeNull();
    expect(result?.main.map((slot) => slot.key)).toEqual([
      'turf',
      'medium',
      'long',
      'pace',
      'late'
    ]);
    expect(result?.secondary).toEqual([]);
  });

  it('unions aptitudes across multiple pickup umas', () => {
    // Special Week (100101: A G F C A A G A A C)
    // + Agnes Digital (101901: A A F A A G G A A B)
    const result = bannerAptitudes(characterEvent([100101, 101901]));
    const mainKeys = result?.main.map((slot) => slot.key) ?? [];
    // Contributed by Agnes Digital only:
    expect(mainKeys).toContain('dirt');
    expect(mainKeys).toContain('mile');
    // Contributed by Special Week only:
    expect(mainKeys).toContain('long');
    // A from either uma wins over B: no key appears in both lists.
    const secondaryKeys = result?.secondary.map((slot) => slot.key) ?? [];
    expect(secondaryKeys).toContain('end');
    for (const key of secondaryKeys) {
      expect(mainKeys).not.toContain(key);
    }
  });

  it('returns null for support banners', () => {
    const event: TimelineEvent = {
      id: 'support-banner',
      card_type: 'support',
      type: 'support_card_banner',
      pickup_card_ids: [30028]
    };
    expect(bannerAptitudes(event)).toBeNull();
  });

  it('returns null when no pickup has aptitude data', () => {
    expect(bannerAptitudes(characterEvent([999999999]))).toBeNull();
  });
});
