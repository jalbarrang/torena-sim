/**
 * Main OCR parser - orchestrates extraction of all data from OCR engine results
 */

import type { OcrEngineResult } from './engine';
import { extractSkills } from './skills';
import { extractStats } from './stats';
import type { ExtractedSkill, ExtractedUmaData } from './types';
import { extractUmaIdentity } from './uma';

function mergeSkills(result: ExtractedUmaData, skills: Array<ExtractedSkill>) {
  const existingIds = new Set(result.skills.map((skill) => skill.id));

  for (const skill of skills) {
    if (!existingIds.has(skill.id)) {
      existingIds.add(skill.id);
      result.skills.push(skill);
    }
  }
}

function parseTextResult(
  result: ExtractedUmaData,
  text: string,
  imageIndex: number,
  existingData?: Partial<ExtractedUmaData>
) {
  // Extract uma identity from first image only
  if (imageIndex === 0 || !existingData?.outfitId) {
    const umaMatch = extractUmaIdentity(text);
    if (umaMatch) {
      result.outfitId = umaMatch.outfitId;
      result.outfitName = umaMatch.outfitName;
      result.umaName = umaMatch.umaName;
      result.umaConfidence = umaMatch.confidence;
    }
  }

  // Extract stats from first image only
  if (imageIndex === 0 || !existingData?.speed) {
    const stats = extractStats(text);
    result.speed = stats.speed ?? result.speed;
    result.stamina = stats.stamina ?? result.stamina;
    result.power = stats.power ?? result.power;
    result.guts = stats.guts ?? result.guts;
    result.wisdom = stats.wisdom ?? result.wisdom;
  }

  // Extract and accumulate skills (dedupe by ID)
  mergeSkills(result, extractSkills(text, imageIndex));

  // Track unrecognized lines for debugging
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const recognizedTexts = new Set(result.skills.map((skill) => skill.originalText.toLowerCase()));

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      !recognizedTexts.has(lower) &&
      line.length > 3 &&
      !/^(speed|stamina|power|guts|wit|track|distance|style|skills|inspiration|career|close|select|cancel|umamusume|details|\d+|[sabcdefg]|turf|dirt|sprint|mile|medium|long|front|pace|late|end|witness|legend|change|epithet|rank|lvl\s*\d+)$/i.test(
        line
      )
    ) {
      result.unrecognized.push(line);
    }
  }
}

function parseStructuredResult(
  result: ExtractedUmaData,
  structured: Partial<ExtractedUmaData>,
  imageIndex: number,
  existingData?: Partial<ExtractedUmaData>
) {
  // Keep first image ownership for identity and stats
  if (imageIndex === 0 || !existingData?.outfitId) {
    result.outfitId = structured.outfitId ?? result.outfitId;
    result.outfitName = structured.outfitName ?? result.outfitName;
    result.umaName = structured.umaName ?? result.umaName;
    result.umaConfidence = structured.umaConfidence ?? result.umaConfidence;
  }

  if (imageIndex === 0 || !existingData?.speed) {
    result.speed = structured.speed ?? result.speed;
    result.stamina = structured.stamina ?? result.stamina;
    result.power = structured.power ?? result.power;
    result.guts = structured.guts ?? result.guts;
    result.wisdom = structured.wisdom ?? result.wisdom;
  }

  result.surfaceAptitude = structured.surfaceAptitude ?? result.surfaceAptitude;
  result.distanceAptitude = structured.distanceAptitude ?? result.distanceAptitude;
  result.strategyAptitude = structured.strategyAptitude ?? result.strategyAptitude;
  result.aptitudes = structured.aptitudes ?? result.aptitudes;
  result.strategy = structured.strategy ?? result.strategy;

  if (structured.skills && structured.skills.length > 0) {
    const structuredSkills: Array<ExtractedSkill> = structured.skills
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        confidence: skill.confidence,
        originalText: skill.originalText,
        fromImage: skill.fromImage
      }))
      .filter((skill) => Boolean(skill.id && skill.name))
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        confidence: skill.confidence ?? 1,
        originalText: skill.originalText ?? skill.name,
        fromImage: skill.fromImage ?? imageIndex
      }));

    mergeSkills(result, structuredSkills);
  }
}

/** Parse complete OCR result and extract all uma data */
export function parseOcrResult(
  engineResult: OcrEngineResult,
  imageIndex: number,
  existingData?: Partial<ExtractedUmaData>
): ExtractedUmaData {
  const result: ExtractedUmaData = {
    outfitId: existingData?.outfitId,
    outfitName: existingData?.outfitName,
    umaName: existingData?.umaName,
    umaConfidence: existingData?.umaConfidence ?? 0,
    speed: existingData?.speed,
    stamina: existingData?.stamina,
    power: existingData?.power,
    guts: existingData?.guts,
    wisdom: existingData?.wisdom,
    surfaceAptitude: existingData?.surfaceAptitude,
    distanceAptitude: existingData?.distanceAptitude,
    strategyAptitude: existingData?.strategyAptitude,
    aptitudes: existingData?.aptitudes,
    strategy: existingData?.strategy,
    skills: existingData?.skills ? [...existingData.skills] : [],
    imageCount: (existingData?.imageCount ?? 0) + 1,
    unrecognized: existingData?.unrecognized ? [...existingData.unrecognized] : []
  };

  if (engineResult.text) {
    parseTextResult(result, engineResult.text, imageIndex, existingData);
  }

  if (engineResult.structured) {
    parseStructuredResult(result, engineResult.structured, imageIndex, existingData);
  }

  return result;
}
