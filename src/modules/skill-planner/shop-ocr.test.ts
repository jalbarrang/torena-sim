import { describe, expect, it, vi } from 'vitest';
import {
  classifyShopMatches,
  cleanRecognizedShopName,
  getShopImportProgressValue,
  matchRecognizedShopRows,
  mergeShopOcrResults,
  parseShopHintLevel,
  processShopImageBatch,
  validateShopImageFiles,
  type ShopOcrSkillMatch
} from './shop-ocr';

function match(id: string, hintLevel: ShopOcrSkillMatch['hintLevel']): ShopOcrSkillMatch {
  return {
    id,
    name: `Skill ${id}`,
    rawName: `Raw ${id}`,
    hintLevel,
    confidence: 1
  };
}

describe('shop OCR parsing and matching', () => {
  it('normalizes a Tesseract O suffix through the canonical skill matcher', () => {
    const result = matchRecognizedShopRows([
      { nameText: 'Left-Handed O\n', hintText: 'Hint Lvl 2\n20% OFF!', confidence: 94 }
    ]);

    expect(result.matches).toEqual([
      expect.objectContaining({ id: '200022', name: 'Left-Handed ○', hintLevel: 2 })
    ]);
  });

  it('tolerates decorative punctuation and OCR edge artifacts', () => {
    const name = cleanRecognizedShopName('|  OMG! (ﾟ∀ﾟ)  The Final Sprint! ☆  _');
    const result = matchRecognizedShopRows([
      { nameText: name, hintText: 'Hint Lv I', confidence: 90 }
    ]);

    expect(result.matches).toEqual([expect.objectContaining({ id: '900191', hintLevel: 1 })]);
  });

  it.each([
    ['Hint Lvl 5', 5],
    ['HINT LEVEL 3', 3],
    ['Hint Lv I', 1],
    ['Hint LvI 2', 2],
    ['10% OFF!', 0],
    ['Hint 10% OFF!', 0],
    ['Hint\n20% OFF!', 0],
    ['Hint Leve? 3', 0],
    ['', 0],
    ['Hint Lvl ?', 0]
  ])('parses %j safely as hint level %i', (text, expected) => {
    expect(parseShopHintLevel(text)).toBe(expected);
  });

  it('deduplicates matched rows in stable order and retains the highest hint', () => {
    const catalog = {
      findBestSkillMatch: vi.fn((name: string) => ({
        id: name.startsWith('First') ? '1' : '2',
        name: name.startsWith('First') ? 'First Skill' : 'Second Skill',
        confidence: 0.9
      })),
      resolveSkillId: (id: string) => id
    };

    const result = matchRecognizedShopRows(
      [
        { nameText: 'First Skill', hintText: 'Hint Lvl 1', confidence: 80 },
        { nameText: 'Second Skill', hintText: 'Hint Lvl 2', confidence: 80 },
        { nameText: 'First Skill', hintText: 'Hint Lvl 4', confidence: 80 }
      ],
      catalog
    );

    expect(result.matches.map(({ id, hintLevel }) => [id, hintLevel])).toEqual([
      ['1', 4],
      ['2', 2]
    ]);
  });
});

describe('validateShopImageFiles', () => {
  it('rejects excess file count, per-file bytes, and cumulative bytes', () => {
    const oneMegabyte = new Uint8Array(1024 * 1024);
    const existing = Array.from({ length: 6 }, () => new Blob([oneMegabyte]));
    const files = [
      new File([new Uint8Array(11 * 1024 * 1024)], 'oversized.png', { type: 'image/png' }),
      new File([oneMegabyte], 'seventh.png', { type: 'image/png' }),
      new File([oneMegabyte], 'eighth.png', { type: 'image/png' }),
      new File([oneMegabyte], 'ninth.png', { type: 'image/png' })
    ];

    const result = validateShopImageFiles(files, existing);

    expect(result.acceptedFiles.map((file) => file.name)).toEqual(['seventh.png', 'eighth.png']);
    expect(result.errors).toEqual([
      'oversized.png: each screenshot must be 10 MB or smaller.',
      'ninth.png: no more than 8 screenshots can be kept in one import.'
    ]);

    const cumulative = validateShopImageFiles(
      [new File([oneMegabyte], 'too-much.png', { type: 'image/png' })],
      [new Blob([new Uint8Array(40 * 1024 * 1024)])]
    );
    expect(cumulative.errors[0]).toContain('40 MB or less');
  });
});

describe('processShopImageBatch', () => {
  it('processes files sequentially and stops before the next file after abort', async () => {
    const controller = new AbortController();
    const recognize = vi.fn().mockResolvedValue({ matches: [], unmatchedNames: [] });
    const files = [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ];

    const result = await processShopImageBatch(files, {
      engine: { recognize },
      signal: controller.signal,
      onResult: () => controller.abort()
    });

    expect(result).toMatchObject({ aborted: true, successfulCount: 1 });
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('continues after a failed image and reports the partial batch', async () => {
    const recognize = vi
      .fn()
      .mockRejectedValueOnce(new Error('bad crop'))
      .mockResolvedValueOnce({ matches: [match('2', 1)], unmatchedNames: [] });

    const result = await processShopImageBatch(
      [
        new File(['a'], 'bad.png', { type: 'image/png' }),
        new File(['b'], 'good.png', { type: 'image/png' })
      ],
      { engine: { recognize }, signal: new AbortController().signal }
    );

    expect(result.successfulCount).toBe(1);
    expect(result.failedFiles).toEqual(['bad.png: bad crop']);
    expect(recognize).toHaveBeenCalledTimes(2);
  });
});

describe('getShopImportProgressValue', () => {
  it('combines settled images with bounded active-image progress', () => {
    expect(
      getShopImportProgressValue({
        activeImage: 1,
        activeImageProgress: 0.4,
        completedImages: 0,
        totalImages: 2
      })
    ).toBe(20);
    expect(
      getShopImportProgressValue({
        activeImage: 2,
        activeImageProgress: 0.5,
        completedImages: 1,
        totalImages: 2
      })
    ).toBe(75);
  });
});

describe('mergeShopOcrResults', () => {
  it('preserves insertion order, deduplicates IDs, and keeps the highest hint', () => {
    const merged = mergeShopOcrResults(
      { matches: [match('200012', 1)], unmatchedNames: ['Unknown A'] },
      {
        matches: [match('200012', 4), match('200021', 2)],
        unmatchedNames: ['Unknown A', 'Unknown B']
      }
    );

    expect(merged.matches.map(({ id, hintLevel }) => [id, hintLevel])).toEqual([
      ['200012', 4],
      ['200021', 2]
    ]);
    expect(merged.unmatchedNames).toEqual(['Unknown A', 'Unknown B']);
  });
});

describe('classifyShopMatches', () => {
  it('blocks exact and family conflicts so applying never replaces existing candidates', () => {
    const classified = classifyShopMatches([match('200012', 2)], {
      existingCandidateIds: ['200011'],
      obtainedSkillIds: [],
      selectableSkillIds: ['200011', '200012']
    });

    expect(classified[0]).toMatchObject({ status: 'candidate-conflict' });
  });

  it('classifies obtained, unavailable, and addable skills', () => {
    const classified = classifyShopMatches(
      [match('200012', 1), match('200021', 2), match('200031', 3)],
      {
        existingCandidateIds: [],
        obtainedSkillIds: ['200012'],
        selectableSkillIds: ['200012', '200031']
      }
    );

    expect(classified.map(({ status }) => status)).toEqual(['obtained', 'unavailable', 'addable']);
  });
});
