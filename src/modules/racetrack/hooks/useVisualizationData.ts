import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import type { SimulationRun, SkillEffectLog } from '@/modules/simulation/compare.types';
import { IRegionDisplayType, RegionDisplayType } from '@/modules/racetrack/types';
import { getSkillNameById } from '@/modules/skills/utils';
import { useSettingsStore } from '@/store/settings.store';
import {
  colors,
  debuffColors,
  fullyChargedColors,
  posKeepColors,
  recoveryColors,
  rushedColors
} from '@/utils/colors';
import { SkillType } from '@/lib/uma-domain/skills/definitions';
import { isExternalDebuffEffect } from '@/lib/uma-domain/skills/external-debuffs';
import { coursesService } from '@/modules/data/services/CourseService';
import { useDebuffs } from '@/modules/simulation/stores/compare.store';
import { useScenarioOverrides } from '@/modules/simulation/stores/scenario-overrides.store';
import { skillsService } from '@/modules/data/services/SkillService';

export type RegionData = {
  type: IRegionDisplayType;
  regions: Array<{
    start: number;
    end: number;
  }>;

  color: {
    fill: string;
    stroke: string;
  };

  text: string;
  height?: number;
  skillId?: string;
  umaIndex?: number;
  effectType?: number;
  debuffId?: string;
  isDebuff?: boolean;
  isEstimate?: boolean;
  markerType?: 'skill' | 'debuff' | 'scenario';
};

const INSTANT_DURATION_THRESHOLD = 1;
type InjectedDebuffRegionRef = {
  id: string;
  skillId: string;
  position: number;
};

type DebuffIndicatorMeta = {
  effectType: number;
  baseDuration: number;
};

const getDebuffIndicatorMeta = (skillId: string): DebuffIndicatorMeta => {
  const fallback: DebuffIndicatorMeta = { effectType: SkillType.Noop, baseDuration: 0 };
  try {
    const skillData = skillsService.getById(skillId);
    if (!skillData) return fallback;

    for (const alternative of skillData.alternatives) {
      for (const effect of alternative.effects) {
        const type = effect.type ?? SkillType.Noop;
        const target = effect.target ?? 0;
        const modifier = effect.modifier ?? 0;

        if (isExternalDebuffEffect({ type, target, modifier })) {
          return { effectType: type, baseDuration: alternative.baseDuration };
        }
      }
    }

    return {
      effectType: skillData.alternatives[0]?.effects[0]?.type ?? SkillType.Noop,
      baseDuration: skillData.alternatives[0]?.baseDuration ?? 0
    };
  } catch {
    return fallback;
  }
};

/**
 * Build RegionData entries from self-skill effect logs.
 * Groups effects by start position — multiple effects at the same position = one activation.
 */
const buildSelfSkillRegions = (
  skillId: string,
  activations: Array<SkillEffectLog>,
  umaIndex: number
): Array<RegionData> => {
  if (activations.length === 0) return [];

  const grouped = new Map<number, Array<SkillEffectLog>>();
  for (const effect of activations) {
    const group = grouped.get(effect.start);
    if (group) group.push(effect);
    else grouped.set(effect.start, [effect]);
  }

  const result: Array<RegionData> = [];
  for (const groupedEffects of grouped.values()) {
    const durationEffect = groupedEffects.find((e) => e.end - e.start > INSTANT_DURATION_THRESHOLD);
    const repr = durationEffect ?? groupedEffects[0];
    const isRecovery = repr.effectType === SkillType.Recovery;
    const color = isRecovery ? recoveryColors[umaIndex] : colors[umaIndex];

    result.push({
      type: durationEffect ? RegionDisplayType.Textbox : RegionDisplayType.Immediate,
      color,
      text: getSkillNameById(skillId),
      skillId,
      umaIndex,
      effectType: repr.effectType,
      regions: [{ start: repr.start, end: repr.end }]
    });
  }

  return result;
};

/**
 * Build RegionData entries from targeted (debuff) skill effect logs.
 * Groups by executionId — each injection is independent, even at the same position.
 * Resolves debuffId by nearest-position matching against the injected debuffs store.
 */
const buildDebuffRegions = (
  skillId: string,
  activations: Array<SkillEffectLog>,
  umaIndex: number,
  injectedDebuffsForUma: Array<InjectedDebuffRegionRef>,
  courseDistance: number
): Array<RegionData> => {
  if (activations.length === 0) return [];

  // Each executionId is a separate activation
  const grouped = new Map<string, Array<SkillEffectLog>>();
  for (const effect of activations) {
    const group = grouped.get(effect.executionId);
    if (group) group.push(effect);
    else grouped.set(effect.executionId, [effect]);
  }

  // Use formula-based duration so all instances of the same debuff render
  // at equal width, regardless of the runner's actual speed at each position.
  const meta = getDebuffIndicatorMeta(skillId);
  const hasDuration = meta.baseDuration > 0;
  const durationSeconds = (meta.baseDuration / 10000) * (courseDistance / 1000);
  const estimatedDuration = hasDuration ? durationSeconds * 20 : 0;

  // Build a mutable list for nearest-position matching
  const availableDebuffs = injectedDebuffsForUma.filter((d) => d.skillId === skillId);
  const resolveDebuffId = (start: number): string | undefined => {
    if (availableDebuffs.length === 0) return undefined;

    let nearestIndex = 0;
    let nearestDistance = Math.abs(availableDebuffs[0].position - start);
    for (let i = 1; i < availableDebuffs.length; i++) {
      const distance = Math.abs(availableDebuffs[i].position - start);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    const matched = availableDebuffs.splice(nearestIndex, 1)[0];
    return matched?.id;
  };

  const result: Array<RegionData> = [];
  for (const groupedEffects of grouped.values()) {
    const durationEffect = groupedEffects.find((e) => e.end - e.start > INSTANT_DURATION_THRESHOLD);
    const repr = durationEffect ?? groupedEffects[0];
    const end = hasDuration ? repr.start + estimatedDuration : repr.end;

    result.push({
      type: durationEffect ? RegionDisplayType.Textbox : RegionDisplayType.Immediate,
      color: debuffColors[umaIndex],
      text: getSkillNameById(skillId),
      skillId,
      umaIndex,
      effectType: repr.effectType,
      regions: [{ start: repr.start, end }],
      debuffId: resolveDebuffId(repr.start),
      isDebuff: true
    });
  }

  return result;
};

type UseVisualizationDataProps = {
  chartData: SimulationRun;
};

export const useVisualizationData = (props: UseVisualizationDataProps) => {
  const { chartData } = props;
  const debuffs = useDebuffs();
  const scenarioOverrides = useScenarioOverrides();
  const hasSimulationData = useMemo(() => {
    return (
      chartData.position.some((runnerPositions) => runnerPositions.length > 0) ||
      chartData.time.some((runnerTimes) => runnerTimes.length > 0)
    );
  }, [chartData]);

  const { courseId } = useSettingsStore(
    useShallow((state) => ({
      courseId: state.courseId
    }))
  );

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  const skillActivations: Array<RegionData> = useMemo(() => {
    const skills: Array<RegionData> = [];

    // Self-skill activations
    if (chartData?.skillActivations) {
      for (const [skillId, activations] of Object.entries(chartData.skillActivations[0])) {
        skills.push(...buildSelfSkillRegions(skillId, activations, 0));
      }
      for (const [skillId, activations] of Object.entries(chartData.skillActivations[1])) {
        skills.push(...buildSelfSkillRegions(skillId, activations, 1));
      }
    }

    // Targeted (debuff) skill activations — sourced from dedicated channel
    if (chartData?.targetedSkillActivations) {
      for (const [skillId, activations] of Object.entries(chartData.targetedSkillActivations[0])) {
        skills.push(...buildDebuffRegions(skillId, activations, 0, debuffs.uma1, course.distance));
      }
      for (const [skillId, activations] of Object.entries(chartData.targetedSkillActivations[1])) {
        skills.push(...buildDebuffRegions(skillId, activations, 1, debuffs.uma2, course.distance));
      }
    }

    // Reconcile debuff regions with current store positions.
    // After dragging a debuff chip, the store position may differ from the
    // simulation-produced start. Shift the region to match the store so the
    // visual stays in sync with the user's drag.
    const debuffStoreMap = new Map<string, number>();
    for (const d of debuffs.uma1) debuffStoreMap.set(d.id, d.position);
    for (const d of debuffs.uma2) debuffStoreMap.set(d.id, d.position);

    for (let i = 0; i < skills.length; i++) {
      const region = skills[i];
      if (!region.isDebuff || !region.debuffId) continue;

      const storePosition = debuffStoreMap.get(region.debuffId);
      if (storePosition == null) continue;

      const r = region.regions[0];
      if (!r || r.start === storePosition) continue;

      const duration = r.end - r.start;
      skills[i] = {
        ...region,
        regions: [{ start: storePosition, end: storePosition + duration }]
      };
    }

    return skills;
  }, [chartData, debuffs, course.distance]);

  const rushedIndicators: Array<RegionData> = useMemo(() => {
    const results: Array<RegionData> = [];

    // Show actual rushed regions from simulation data
    if (chartData?.rushed) {
      for (const [umaIndex, rushArray] of chartData.rushed.entries()) {
        for (const rush of rushArray) {
          results.push({
            type: RegionDisplayType.Textbox,
            color: rushedColors[umaIndex],
            text: 'Rushed',
            umaIndex,
            regions: [{ start: rush[0], end: rush[1] }]
          });
        }
      }
    }

    // Show forced rushed region previews when no sim data
    if (!hasSimulationData) {
      const entries: Array<[number, typeof scenarioOverrides.uma1]> = [
        [0, scenarioOverrides.uma1],
        [1, scenarioOverrides.uma2]
      ];
      for (const [umaIndex, overrides] of entries) {
        if (overrides.forcedRushed) {
          results.push({
            type: RegionDisplayType.Textbox,
            color: rushedColors[umaIndex],
            text: 'Rushed (forced)',
            skillId: '__forced_rushed',
            markerType: 'scenario',
            umaIndex,
            isEstimate: true,
            regions: [{ start: overrides.forcedRushed.start, end: overrides.forcedRushed.end }]
          });
        }
        if (overrides.forcedDueling) {
          results.push({
            type: RegionDisplayType.Textbox,
            color: posKeepColors[umaIndex],
            text: 'Duel (forced)',
            skillId: '__forced_dueling',
            markerType: 'scenario',
            umaIndex,
            isEstimate: true,
            regions: [{ start: overrides.forcedDueling.start, end: overrides.forcedDueling.end }]
          });
        }
        if (overrides.forcedSpotStruggle) {
          results.push({
            type: RegionDisplayType.Textbox,
            color: posKeepColors[umaIndex],
            text: 'SS (forced)',
            skillId: '__forced_spot_struggle',
            markerType: 'scenario',
            umaIndex,
            isEstimate: true,
            regions: [
              { start: overrides.forcedSpotStruggle.start, end: overrides.forcedSpotStruggle.end }
            ]
          });
        }
      }
    }

    return results;
  }, [chartData, hasSimulationData, scenarioOverrides]);

  const fullyChargedIndicators: Array<RegionData> = useMemo(() => {
    const results: Array<RegionData> = [];

    if (chartData?.fullyChargedRegions) {
      for (const [umaIndex, region] of chartData.fullyChargedRegions.entries()) {
        if (!region || region.length !== 2) continue;
        const [start, end] = region;
        results.push({
          type: RegionDisplayType.Textbox,
          color: fullyChargedColors[umaIndex],
          text: 'Fully Charged!',
          umaIndex,
          regions: [{ start, end }]
        });
      }
    }

    return results;
  }, [chartData]);

  const debuffIndicators: Array<RegionData> = useMemo(() => {
    if (hasSimulationData) {
      return [];
    }

    const results: Array<RegionData> = [];
    const entries: Array<[number, typeof debuffs.uma1]> = [
      [0, debuffs.uma1],
      [1, debuffs.uma2]
    ];

    for (const [umaIndex, umaDebuffs] of entries) {
      for (const debuff of umaDebuffs) {
        const meta = getDebuffIndicatorMeta(debuff.skillId);
        const hasDuration = meta.baseDuration > 0;
        // baseDuration is in raw units (÷10000 → seconds), scaled by courseDistance/1000.
        // Convert to estimated meters using approximate race speed (~20 m/s).
        const durationSeconds = (meta.baseDuration / 10000) * (course.distance / 1000);
        const estimatedEnd = hasDuration ? debuff.position + durationSeconds * 20 : debuff.position;

        results.push({
          type: hasDuration ? RegionDisplayType.Textbox : RegionDisplayType.Immediate,
          color: debuffColors[umaIndex],
          text: getSkillNameById(debuff.skillId),
          skillId: debuff.skillId,
          umaIndex,
          effectType: meta.effectType,
          debuffId: debuff.id,
          regions: [{ start: debuff.position, end: estimatedEnd }],
          isDebuff: true,
          isEstimate: true
        });
      }
    }

    return results;
  }, [debuffs, hasSimulationData, course]);

  // Contention mechanics (dueling / spot struggle) render as distance-marker
  // chips in the per-uma skill rows, same treatment as Rushed — not as line
  // overlays on the chart geometry.
  const contentionIndicators: Array<RegionData> = useMemo(() => {
    const results: Array<RegionData> = [];

    if (chartData?.duelingRegions) {
      for (const [umaIndex, region] of chartData.duelingRegions.entries()) {
        const [start, end] = region;
        if (start == null || end == null) continue;
        results.push({
          type: RegionDisplayType.Textbox,
          color: posKeepColors[umaIndex],
          text: 'Duel',
          umaIndex,
          regions: [{ start, end }]
        });
      }
    }

    if (chartData?.spotStruggleRegions) {
      for (const [umaIndex, region] of chartData.spotStruggleRegions.entries()) {
        const [start, end] = region;
        if (start == null || end == null) continue;
        results.push({
          type: RegionDisplayType.Textbox,
          color: posKeepColors[umaIndex],
          text: 'Spot Struggle',
          umaIndex,
          regions: [{ start, end }]
        });
      }
    }

    return results;
  }, [chartData]);

  return {
    skillActivations,
    rushedIndicators,
    fullyChargedIndicators,
    debuffIndicators,
    contentionIndicators
  };
};
