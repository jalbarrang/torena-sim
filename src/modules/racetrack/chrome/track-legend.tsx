import { SkillType } from '@/lib/uma-domain/skills/definitions';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import { colors, debuffColors } from '@/utils/colors';
import { EffectSymbol } from '../primitives/effect-symbol';
import React from 'react';
import { Separator } from '@/components/ui/separator';

const EFFECT_ITEMS = [
  { label: 'Speed', type: SkillType.TargetSpeed },
  { label: 'Accel', type: SkillType.Accel },
  { label: 'Recovery / drain', type: SkillType.Recovery },
  { label: 'Lane', type: SkillType.LaneMovementSpeed }
] as const;

const RUNNER_PAIR_COLORS = [
  {
    key: 'uma1',
    skill: colors[0],
    debuff: debuffColors[0]
  },
  {
    key: 'uma2',
    skill: colors[1],
    debuff: debuffColors[1]
  }
] as const;

export const TrackLegend = React.memo(() => {
  const names = useComparePairNames();
  const runnerPairs = RUNNER_PAIR_COLORS.map((pair) => ({
    ...pair,
    label: names[pair.key]
  }));

  return (
    <div className="flex flex-wrap items-center gap-3 px-2 text-xs text-foreground">
      <span className="pr-2 font-semibold tracking-wide text-foreground">Legend</span>

      <Separator orientation="vertical" />

      <div className="flex flex-wrap items-center gap-3">
        {EFFECT_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <g transform="translate(8 8)">
                <EffectSymbol
                  effectType={item.type}
                  color={{ fill: 'currentColor', stroke: 'currentColor' }}
                  size={5.5}
                />
              </g>
            </svg>
            <span className="text-foreground/90">{item.label}</span>
          </div>
        ))}
      </div>

      <Separator orientation="vertical" />

      <div className="flex flex-wrap items-center gap-2">
        {runnerPairs.map((pair) => (
          <div
            key={pair.key}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-zinc-100/70 px-1.5 py-1 dark:bg-zinc-900/45"
          >
            <span className="text-[11px] font-medium text-foreground/95">{pair.label}</span>
            <span className="mx-0.5 h-3 w-px bg-border/70" aria-hidden="true" />
            <span className="inline-flex items-center gap-1 rounded-sm border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200">
              <span
                className="inline-flex size-2.5 rounded-full border"
                style={{
                  backgroundColor: pair.skill.fill,
                  borderColor: pair.skill.stroke
                }}
                aria-hidden="true"
              />
              Skill
            </span>
            <span className="inline-flex items-center gap-1 rounded-sm border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200">
              <span
                className="inline-flex size-2.5 rounded-full border"
                style={{
                  backgroundColor: pair.debuff.fill,
                  borderColor: pair.debuff.stroke
                }}
                aria-hidden="true"
              />
              Debuff Hit
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
