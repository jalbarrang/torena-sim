import { skillsService } from '@/modules/data/services/SkillService';
import { ExtractedUmaData } from '../../ocr/types';
import { SkillEntry } from '@/modules/data/services/SkillService';

export type OcrSkillPickerOption = {
  id: string;
  name: string;
  meta: string;
  searchValue: string;
};

export function getOcrSkillOptionMeta(skill: SkillEntry): string {
  if (skill.id.startsWith('9')) {
    return `${skill.id} · inherited`;
  }

  if (skill.id.startsWith('1')) {
    return `${skill.id} · base/unique`;
  }

  return skill.id;
}

export function createManualOcrSkillEntry(
  skillId: string,
  previous?: ExtractedUmaData['skills'][number]
): ExtractedUmaData['skills'][number] | null {
  const skill = skillsService.getById(skillId);
  if (!skill) {
    return null;
  }

  return {
    id: skillId,
    name: skill.name,
    confidence: 1,
    originalText: previous?.originalText ?? `[Manual] ${skill.name}`,
    fromImage: previous?.fromImage ?? 0
  };
}

export function hasDetectedData(results: Partial<ExtractedUmaData> | null): boolean {
  return Boolean(
    results &&
    (results.outfitId ||
      results.speed ||
      results.stamina ||
      results.power ||
      results.guts ||
      results.wisdom ||
      (results.skills && results.skills.length > 0) ||
      results.surfaceAptitude ||
      results.distanceAptitude ||
      results.strategyAptitude ||
      results.aptitudes ||
      results.strategy)
  );
}

export function toExtractedUmaData(results: Partial<ExtractedUmaData>): ExtractedUmaData {
  return {
    umaConfidence: 0,
    skills: [],
    imageCount: 0,
    unrecognized: [],
    ...results
  };
}
