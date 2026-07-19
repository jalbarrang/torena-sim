import type {
  ScalingEffectLike,
  ValueScalingDescriptor,
  ValueScalingDisplayModel
} from './descriptor.types';

const BEST_TIER_MULTIPLIER = 1.2;

const AOHARU_TIERS = [
  { label: '<1200', multiplier: 0.8 },
  { label: '1200–1799', multiplier: 0.9 },
  { label: '1800–2599', multiplier: 1 },
  { label: '2600–3599', multiplier: 1.1 },
  { label: '3600+', multiplier: BEST_TIER_MULTIPLIER }
] as const;

function buildAoharuTeamStatsDisplay(
  effects: ReadonlyArray<ScalingEffectLike>
): ValueScalingDisplayModel {
  return {
    usage: effects[0]?.valueUsage ?? 3,
    header: 'Scales with racing-team stats',
    resolution: 'fixed',
    tiers: AOHARU_TIERS,
    activeTierIndex: AOHARU_TIERS.length - 1,
    trailing: 'best tier pre-applied → 1.2×',
    rows: effects.map((effect) => ({
      effectType: effect.type,
      base: effect.modifier / BEST_TIER_MULTIPLIER,
      multiplier: BEST_TIER_MULTIPLIER,
      result: effect.modifier
    })),
    notes: ['The extract pre-applies the best tier, so the simulator assumes a 3600+ team total.']
  };
}

/**
 * Aoharu team-stats scaling (usages 3–7). The multiplier tier (0.8x–1.2x) is
 * computed at race time from the racing team's combined base stat matching the
 * skill, and applies in TT/CM as well as in-scenario. The data extract
 * pre-applies the best tier (1.2x) to the stored modifier (`patchModifier` in
 * extract-skills.ts), so the engine resolves these effects as Direct on the
 * already-scaled value — assuming a >= 3600-total team.
 * See docs/mechanics/README.md § "Aoharu Skills (3-7)".
 */
export const aoharuTeamStatsValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [3, 4, 5, 6, 7],
  name: 'MultiplyAoharuTeamStats',
  simulatable: true,
  describe: () => 'Scales with racing-team stats (0.8–1.2×); best tier (1.2×) already applied',
  buildDisplay: buildAoharuTeamStatsDisplay
});
