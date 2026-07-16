import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SkillType,
  translateSkillEffectType,
  translateSkillEffectTarget,
  type ISkillType,
  type ISkillTarget
} from '../../../src/lib/uma-domain/skills/definitions';
import {
  isExternalDebuffEffect,
  isInjectableExternalDebuffSkill
} from '../../../src/lib/uma-domain/skills/external-debuffs';

// ── Types ──────────────────────────────────────────

type RawEffect = {
  type: number;
  modifier: number;
  target?: number;
  valueUsage?: number;
  valueLevelUsage?: number;
};

type RawAlternative = {
  precondition?: string;
  condition: string;
  baseDuration: number;
  cooldownTime?: number;
  effects: Array<RawEffect>;
};

type RawSkillEntry = {
  id: string;
  rarity: number;
  groupId: number;
  versions: Array<number>;
  iconId: string;
  baseCost: number;
  order: number;
  name: string;
  character: Array<number>;
  alternatives: Array<RawAlternative>;
};

// ── Constants ──────────────────────────────────────

const RARITY_NAMES: Record<number, string> = {
  1: 'White',
  2: 'Gold',
  3: 'Unique',
  4: 'Unique',
  5: 'Unique',
  6: 'Evolution'
};

/**
 * Duration-based effect types — tracked in runner's active effect arrays.
 * Mirrors ACTIVE_EFFECT_TYPES from race-observer.ts.
 */
const DURATION_EFFECT_TYPES = new Set<number>([
  SkillType.TargetSpeed,
  SkillType.Accel,
  SkillType.LaneMovementSpeed,
  SkillType.CurrentSpeed,
  SkillType.CurrentSpeedWithNaturalDeceleration,
  SkillType.ChangeLane
]);

/**
 * Raw baseDuration in skill data is in 1/10000 of a second.
 * The runner converts it via: baseDuration / 10000 * (courseDistance / 1000)
 */
const BASE_DURATION_DIVISOR = 10000;

// ── Data Loading ───────────────────────────────────

let cachedPath: string | undefined;
let cachedMtimeMs: number | undefined;
let cachedSkills: Map<string, RawSkillEntry> | undefined;

function loadSkills(cwd: string): Map<string, RawSkillEntry> {
  const path = resolve(cwd, 'src/modules/data/json/skills.json');
  const mtimeMs = statSync(path).mtimeMs;

  if (cachedSkills && cachedPath === path && cachedMtimeMs === mtimeMs) {
    return cachedSkills;
  }

  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, RawSkillEntry>;
  cachedSkills = new Map(Object.entries(raw));
  cachedPath = path;
  cachedMtimeMs = mtimeMs;
  return cachedSkills;
}

// ── Helpers ────────────────────────────────────────

function effectTypeName(type: number): string {
  return translateSkillEffectType(type as ISkillType) ?? `Unknown (${type})`;
}

function targetName(target: number | undefined): string {
  if (target === undefined) return 'Self';
  return translateSkillEffectTarget(target as ISkillTarget) ?? `Unknown (${target})`;
}

function isDurationEffect(type: number): boolean {
  return DURATION_EFFECT_TYPES.has(type);
}

function toEffectLike(eff: RawEffect): { type: number; target: number; modifier: number } {
  return { type: eff.type, target: eff.target ?? SkillType.Noop, modifier: eff.modifier };
}

// ── Public API ─────────────────────────────────────

export type InspectedEffect = {
  type: number;
  typeName: string;
  modifier: number;
  target: number | undefined;
  targetName: string;
  isDuration: boolean;
  isDebuff: boolean;
};

export type InspectedAlternative = {
  condition: string;
  precondition?: string;
  baseDuration: number;
  baseDurationSeconds: number;
  cooldownTime?: number;
  effects: Array<InspectedEffect>;
};

export type SkillInspection = {
  id: string;
  name: string;
  rarity: number;
  rarityName: string;
  groupId: number;
  baseCost: number;
  alternatives: Array<InspectedAlternative>;
};

export type DurationEstimate = {
  id: string;
  name: string;
  courseDistance: number;
  estimatedSpeed: number;
  alternatives: Array<{
    condition: string;
    baseDurationRaw: number;
    baseDurationSeconds: number;
    scaledDurationSeconds: number;
    estimatedMeters: number;
    effects: Array<{
      typeName: string;
      modifier: number;
      isDuration: boolean;
    }>;
  }>;
};

export type EffectClassification = {
  id: string;
  name: string;
  isInjectableDebuff: boolean;
  alternatives: Array<{
    condition: string;
    hasDurationEffects: boolean;
    hasInstantEffects: boolean;
    effects: Array<{
      typeName: string;
      modifier: number;
      category: 'instant-self' | 'instant-debuff' | 'duration-self' | 'duration-debuff';
      isDebuff: boolean;
    }>;
  }>;
};

export function inspectSkill(cwd: string, skillId: string): SkillInspection | null {
  const skills = loadSkills(cwd);
  const skill = skills.get(skillId);
  if (!skill) return null;

  return {
    id: skill.id,
    name: skill.name,
    rarity: skill.rarity,
    rarityName: RARITY_NAMES[skill.rarity] ?? `Rarity ${skill.rarity}`,
    groupId: skill.groupId,
    baseCost: skill.baseCost,
    alternatives: skill.alternatives.map((alt) => ({
      condition: alt.condition,
      precondition: alt.precondition,
      baseDuration: alt.baseDuration,
      baseDurationSeconds: alt.baseDuration / BASE_DURATION_DIVISOR,
      cooldownTime: alt.cooldownTime,
      effects: alt.effects.map((eff) => {
        const debuff = isExternalDebuffEffect(toEffectLike(eff));
        return {
          type: eff.type,
          typeName: effectTypeName(eff.type),
          modifier: eff.modifier,
          target: eff.target,
          targetName: targetName(eff.target),
          isDuration: isDurationEffect(eff.type),
          isDebuff: debuff
        };
      })
    }))
  };
}

export function estimateSkillDuration(
  cwd: string,
  skillId: string,
  courseDistance: number,
  estimatedSpeed?: number
): DurationEstimate | null {
  const skills = loadSkills(cwd);
  const skill = skills.get(skillId);
  if (!skill) return null;

  const speed = estimatedSpeed ?? 20;

  return {
    id: skill.id,
    name: skill.name,
    courseDistance,
    estimatedSpeed: speed,
    alternatives: skill.alternatives.map((alt) => {
      const baseDurationSeconds = alt.baseDuration / BASE_DURATION_DIVISOR;
      const scaledDurationSeconds = baseDurationSeconds * (courseDistance / 1000);
      const estimatedMeters = scaledDurationSeconds * speed;

      return {
        condition: alt.condition,
        baseDurationRaw: alt.baseDuration,
        baseDurationSeconds,
        scaledDurationSeconds,
        estimatedMeters,
        effects: alt.effects.map((eff) => ({
          typeName: effectTypeName(eff.type),
          modifier: eff.modifier,
          isDuration: isDurationEffect(eff.type)
        }))
      };
    })
  };
}

export function classifySkillEffects(cwd: string, skillId: string): EffectClassification | null {
  const skills = loadSkills(cwd);
  const skill = skills.get(skillId);
  if (!skill) return null;

  const injectable = isInjectableExternalDebuffSkill(skill as any);

  const alternatives = skill.alternatives.map((alt) => {
    const effects = alt.effects.map((eff) => {
      const debuff = isExternalDebuffEffect(toEffectLike(eff));
      const duration = isDurationEffect(eff.type);

      const category = (
        duration
          ? debuff
            ? 'duration-debuff'
            : 'duration-self'
          : debuff
            ? 'instant-debuff'
            : 'instant-self'
      ) as 'instant-self' | 'instant-debuff' | 'duration-self' | 'duration-debuff';

      return {
        typeName: effectTypeName(eff.type),
        modifier: eff.modifier,
        category,
        isDebuff: debuff
      };
    });

    return {
      condition: alt.condition,
      hasDurationEffects: effects.some((e) => e.category.startsWith('duration')),
      hasInstantEffects: effects.some((e) => e.category.startsWith('instant')),
      effects
    };
  });

  return {
    id: skill.id,
    name: skill.name,
    isInjectableDebuff: injectable,
    alternatives
  };
}

// ── Formatters ─────────────────────────────────────

export function formatInspection(result: SkillInspection): string {
  const lines: Array<string> = [
    `${result.id} ${result.name} [${result.rarityName}] group:${result.groupId} cost:${result.baseCost}`
  ];

  for (const [i, alt] of result.alternatives.entries()) {
    if (result.alternatives.length > 1) {
      lines.push(`\nAlternative ${i + 1}:`);
    }
    lines.push(`  condition: ${alt.condition}`);
    if (alt.precondition) lines.push(`  precondition: ${alt.precondition}`);
    lines.push(`  baseDuration: ${alt.baseDuration} (${alt.baseDurationSeconds}s)`);
    if (alt.cooldownTime) lines.push(`  cooldown: ${alt.cooldownTime}`);

    for (const eff of alt.effects) {
      const flags: Array<string> = [];
      if (eff.isDuration) flags.push('duration');
      if (eff.isDebuff) flags.push('DEBUFF');
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

      lines.push(
        `  effect: ${eff.typeName} (${eff.type}) modifier:${eff.modifier} target:${eff.targetName}${flagStr}`
      );
    }
  }

  return lines.join('\n');
}

export function formatDurationEstimate(result: DurationEstimate): string {
  const lines: Array<string> = [
    `${result.id} ${result.name} — duration estimate @ ${result.courseDistance}m (speed: ${result.estimatedSpeed} m/s)`
  ];

  for (const alt of result.alternatives) {
    lines.push(`  condition: ${alt.condition}`);
    lines.push(
      `  baseDuration: ${alt.baseDurationRaw} → ${alt.baseDurationSeconds}s base → ${alt.scaledDurationSeconds.toFixed(2)}s scaled → ~${Math.round(alt.estimatedMeters)}m`
    );
    for (const eff of alt.effects) {
      lines.push(
        `    ${eff.typeName}: ${eff.modifier > 0 ? '+' : ''}${eff.modifier} ${eff.isDuration ? '(duration)' : '(instant)'}`
      );
    }
  }

  return lines.join('\n');
}

export function formatClassification(result: EffectClassification): string {
  const lines: Array<string> = [
    `${result.id} ${result.name} — injectable debuff: ${result.isInjectableDebuff ? 'YES' : 'no'}`
  ];

  for (const [i, alt] of result.alternatives.entries()) {
    if (result.alternatives.length > 1) {
      lines.push(`\nAlternative ${i + 1}:`);
    }
    lines.push(`  condition: ${alt.condition}`);

    const traits: Array<string> = [];
    if (alt.hasDurationEffects) traits.push('has-duration');
    if (alt.hasInstantEffects) traits.push('has-instant');
    lines.push(`  traits: ${traits.join(', ')}`);

    for (const eff of alt.effects) {
      lines.push(
        `  ${eff.category}: ${eff.typeName} ${eff.modifier > 0 ? '+' : ''}${eff.modifier}${eff.isDebuff ? ' ← DEBUFF' : ''}`
      );
    }
  }

  return lines.join('\n');
}
