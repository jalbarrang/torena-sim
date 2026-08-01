import type { PreparedImage, WizardStep } from '@/modules/runners/components/ocr/types';

export const WIZARD_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'align', label: 'Upload' },
  { id: 'review-identity', label: 'Uma' },
  { id: 'review-skills', label: 'Skills' },
  { id: 'summary', label: 'Summary' }
];

/** Previous step in the wizard flow, or null on upload step. */
export function getPreviousWizardStep(step: WizardStep): WizardStep | null {
  if (step === 'review-identity') {
    return 'align';
  }
  if (step === 'review-skills') {
    return 'review-identity';
  }
  if (step === 'summary') {
    return 'review-skills';
  }
  return null;
}

/** Next step after review steps; null on upload or summary (apply handles summary). */
export function getNextWizardStep(step: WizardStep): WizardStep | null {
  if (step === 'review-identity') {
    return 'review-skills';
  }
  if (step === 'review-skills') {
    return 'summary';
  }
  return null;
}

export function createPreparedImage(
  blob: Blob,
  maskType: PreparedImage['maskType']
): PreparedImage {
  return {
    blob,
    maskType,
    preview: URL.createObjectURL(blob),
    name: blob instanceof File ? blob.name : undefined
  };
}
