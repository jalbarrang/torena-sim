import type { ValueScalingDescriptor } from './descriptor.types';

/**
 * Aoharu-scenario team-stats scaling (usages 3–7). The multiplier tier
 * (0.8x–1.2x) is driven by the training team's total base stats, a datum that
 * only exists inside the Aoharu scenario. Outside the scenario (CM / Team
 * Trials — the races this simulator models) the game applies the base value
 * unchanged (1.0x), so the engine resolves these effects as Direct.
 * See docs/mechanics/README.md § "Aoharu Skills (3-7)".
 */
export const aoharuTeamStatsValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [3, 4, 5, 6, 7],
  name: 'MultiplyAoharuTeamStats',
  simulatable: true,
  describe: () => 'Scales with Aoharu team stats in-scenario; base value (1.0×) in normal races'
});
