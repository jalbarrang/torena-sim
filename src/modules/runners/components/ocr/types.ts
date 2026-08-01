export type OcrMaskType = 'full-details-own' | 'full-details-other' | 'skills-only';

interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

export interface PreparedImage {
  blob: Blob;
  maskType: OcrMaskType;
  preview: string; // object URL for thumbnail
  name?: string;
}

export type WizardStep = 'align' | 'review-identity' | 'review-skills' | 'summary';
