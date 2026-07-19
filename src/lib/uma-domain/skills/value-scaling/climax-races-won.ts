import type {
  ScalingEffectLike,
  ValueScalingDescriptor,
  ValueScalingDisplayModel
} from './descriptor.types';

const CLIMAX_TIERS = [
  { label: '<6', multiplier: 0.8 },
  { label: '6–13', multiplier: 0.9 },
  { label: '14–17', multiplier: 1 },
  { label: '18–24', multiplier: 1.1 },
  { label: '25+', multiplier: 1.2 }
] as const;

function buildClimaxRacesWonDisplay(
  effects: ReadonlyArray<ScalingEffectLike>
): ValueScalingDisplayModel {
  return {
    usage: 10,
    header: 'Scales with training races won',
    resolution: 'unsupported',
    tiers: CLIMAX_TIERS,
    activeTierIndex: CLIMAX_TIERS.length - 1,
    trailing: 'best tier pre-applied → 1.2×',
    rows: effects.map((effect) => ({
      effectType: effect.type,
      base: effect.modifier / 1.2,
      multiplier: 1.2,
      result: effect.modifier
    })),
    notes: ['The extract pre-applies the best tier. This scaling is not yet simulated.']
  };
}

export const climaxRacesWonValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [10],
  name: 'MultiplyClimaxRacesWon',
  simulatable: false,
  describe: () => 'Scales with training races won (0.8–1.2×); not yet simulated',
  buildDisplay: buildClimaxRacesWonDisplay
});
