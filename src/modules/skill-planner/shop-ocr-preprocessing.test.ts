import { describe, expect, it } from 'vitest';
import {
  assertShopScreenshotDimensions,
  getPreprocessedShopCropPixels,
  getShopRowCrops,
  SHOP_OCR_IMAGE_LIMITS
} from './shop-ocr-preprocessing';

describe('getShopRowCrops', () => {
  it('uses width-relative card geometry and keeps all crops inside the image', () => {
    const rows = getShopRowCrops({ width: 620, height: 507 });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.name.top)).toEqual([7, 182, 357]);
    expect(rows[0].name).toMatchObject({ left: 96, width: 347, height: 53 });
    expect(rows[0].hint).toMatchObject({ left: 450, width: 149, height: 81 });

    for (const row of rows) {
      for (const crop of [row.name, row.hint]) {
        expect(crop.left).toBeGreaterThanOrEqual(0);
        expect(crop.top).toBeGreaterThanOrEqual(0);
        expect(crop.left + crop.width).toBeLessThanOrEqual(620);
        expect(crop.top + crop.height).toBeLessThanOrEqual(507);
      }
    }
  });

  it('retains the clipped third row instead of splitting a short screenshot into thirds', () => {
    const rows = getShopRowCrops({ width: 606, height: 467 });

    expect(rows.map((row) => row.name.top)).toEqual([7, 178, 349]);
    expect(rows[2].name.height).toBeGreaterThan(40);
  });

  it('returns no jobs for invalid image dimensions', () => {
    expect(getShopRowCrops({ width: 0, height: 100 })).toEqual([]);
  });

  it('rejects oversized decoded images before creating OCR crops', () => {
    expect(() => assertShopScreenshotDimensions({ width: 5001, height: 1000 })).toThrow(
      '5000 × 5000'
    );
    expect(() => assertShopScreenshotDimensions({ width: 5000, height: 5000 })).toThrow(
      'too large'
    );
    expect(() => assertShopScreenshotDimensions({ width: 4000, height: 4000 })).not.toThrow();
  });

  it('keeps the largest permitted screenshot crop below the canvas pixel cap', () => {
    const [row] = getShopRowCrops({ width: 5000, height: 4000 });
    expect(getPreprocessedShopCropPixels(row.name)).toBeLessThanOrEqual(
      SHOP_OCR_IMAGE_LIMITS.maxCropPixels
    );
  });
});
