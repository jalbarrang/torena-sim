import { useMemo } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HintLevel } from '@/modules/skill-planner/types';
import { useSkillItem } from './context';

// Presentation table for the stepper. Discount values mirror HINT_DISCOUNTS in
// cost-calculator.ts (the canonical source); the short labels are stepper-only.
const HINT_STEPS: ReadonlyArray<{ level: HintLevel; label: string; off: string }> = [
  { level: 0, label: 'No hint', off: '0%' },
  { level: 1, label: 'Lv 1', off: '10%' },
  { level: 2, label: 'Lv 2', off: '20%' },
  { level: 3, label: 'Lv 3', off: '30%' },
  { level: 4, label: 'Lv 4', off: '35%' },
  { level: 5, label: 'Lv Max', off: '40%' }
];

const MIN_LEVEL = 0;
const MAX_LEVEL = 5;

type SkillItemHintStepperProps = {
  className?: string;
};

/**
 * Inline − / + control for a skill's hint level. Reads the current level from
 * the shared SkillItem context and writes through the same `onHintLevelChange`
 * action the cost popover's Select uses, so both stay in sync.
 *
 * Renders nothing when hint tuning does not apply: no `onHintLevelChange`
 * handler, or the skill is already obtained (cost 0, hint irrelevant).
 */
export function SkillItemHintStepper(props: Readonly<SkillItemHintStepperProps>) {
  const { className } = props;
  const { skillId, getSkillMeta, onHintLevelChange, costSummary } = useSkillItem();

  const meta = useMemo(() => getSkillMeta(skillId), [getSkillMeta, skillId]);
  const isObtained = costSummary?.isObtained ?? meta.bought ?? false;

  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, meta.hintLevel)) as HintLevel;
  const step = HINT_STEPS[level];

  if (!onHintLevelChange || isObtained) {
    return null;
  }

  const setLevel = (next: number) => {
    const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, next));
    if (clamped !== level) {
      onHintLevelChange(skillId, clamped);
    }
  };

  const atMin = level <= MIN_LEVEL;
  const atMax = level >= MAX_LEVEL;

  return (
    <div
      className={cn(
        'inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-muted/30',
        className
      )}
      title={`Hint ${step.label} · ${step.off} off`}
    >
      <button
        type="button"
        aria-label="Lower hint level"
        disabled={atMin}
        onClick={(event) => {
          event.stopPropagation();
          setLevel(level - 1);
        }}
        className="grid h-full w-6 place-items-center text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground/40"
      >
        <MinusIcon className="size-3.5" />
      </button>

      <div className="flex h-full items-baseline gap-1.5 border-x border-border px-2">
        <span className="text-xs font-semibold leading-none">{step.label}</span>
        <span
          className={cn(
            'font-mono text-[11px] font-semibold leading-none',
            // Light `--primary` (#66bf0d) only clears ~2.3:1 on the light control
            // surface — below AA for this small text. Use a deeper green in light
            // mode; dark `--primary` (#57a112) already passes on charcoal.
            level === 0 ? 'text-muted-foreground' : 'text-[#2f6b09] dark:text-primary'
          )}
        >
          {step.off}
        </span>
      </div>

      <button
        type="button"
        aria-label="Raise hint level"
        disabled={atMax}
        onClick={(event) => {
          event.stopPropagation();
          setLevel(level + 1);
        }}
        className="grid h-full w-6 place-items-center text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground/40"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}
