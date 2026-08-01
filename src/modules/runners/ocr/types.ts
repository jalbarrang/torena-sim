/**
 * Types specific to OCR extraction
 */

import type { IStrategyName } from '@/lib/uma-domain/runner/definitions';
import type { RunnerAptitudes } from '@/modules/runners/components/runner-card/domain/runner-state';
import type { SkillMatch } from '@/modules/runners/data/types';

/** Extracted skill with image source tracking */
export interface ExtractedSkill extends SkillMatch {
  fromImage: number;
}

/** Complete extracted data from OCR processing */
export interface ExtractedUmaData {
  // Uma identity
  outfitId?: string;
  outfitName?: string;
  umaName?: string;
  umaConfidence: number;

  // Stats
  speed?: number;
  stamina?: number;
  power?: number;
  guts?: number;
  wisdom?: number;

  // Aptitudes and strategy
  surfaceAptitude?: string;
  distanceAptitude?: string;
  strategyAptitude?: string;
  // Full 10-bucket aptitude grades (higher fidelity than the 3 collapsed above).
  aptitudes?: RunnerAptitudes;
  strategy?: IStrategyName;

  // Skills
  skills: Array<ExtractedSkill>;

  // Metadata
  imageCount: number;
  unrecognized: Array<string>;
}
