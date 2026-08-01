// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShopScreenshotImportDialog } from './ShopScreenshotImportDialog';

vi.mock('../shop-ocr-engine', () => ({
  LocalShopOcrEngine: class {
    recognize = vi.fn();
    destroy = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('../shop-ocr-preprocessing', async (importOriginal) => {
  const original = await importOriginal<typeof import('../shop-ocr-preprocessing')>();
  return {
    ...original,
    createShopThumbnailPreview: vi.fn()
  };
});

afterEach(() => {
  cleanup();
});

describe('ShopScreenshotImportDialog', () => {
  it('marks the complete OCR surface private and exposes ordered current-step semantics', () => {
    render(
      <ShopScreenshotImportDialog
        open
        onOpenChange={vi.fn()}
        existingCandidateIds={[]}
        obtainedSkillIds={[]}
        selectableSkillIds={[]}
        onApply={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList.contains('ph-no-capture')).toBe(true);
    expect(dialog.classList.contains('ph-mask')).toBe(true);
    expect(screen.getByRole('list', { name: 'Import steps' })).toBeTruthy();
    expect(screen.getByText('1 Upload').getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('2 Review').getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByText(/images are read in your browser and are never sent to an ocr service/i)
    ).toBeTruthy();
    expect(screen.getByText(/up to 8 images, 10 mb each, 40 mb total/i)).toBeTruthy();
  });
});
