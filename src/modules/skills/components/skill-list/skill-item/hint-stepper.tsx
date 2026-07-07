import { useMemo } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HintLevel } from '@/modules/skill-planner/types';
import {
  getHintDiscountPercent,
  MAX_HINT_LEVEL,
  MIN_HINT_LEVEL
} from '@/modules/skill-planner/hint-levels';
import { useSkillItem } from './context';

const getStepLabel = (level: HintLevel): string => {
  if (level === MIN_HINT_LEVEL) return 'No hint';
  if (level === MAX_HINT_LEVEL) return 'Lv Max';
  return `Lv ${level}`;
};

const clampLevel = (level: number): HintLevel => {
  return Math.min(MAX_HINT_LEVEL, Math.max(MIN_HINT_LEVEL, level)) as HintLevel;
};

type HintLevelStepperProps = {
  level: HintLevel;
  onChange: (level: HintLevel) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Controlled − / + hint level control (0–5). Shows the level label with the
 * discount percentage when a hint is set. Used inline on skill cards (via
 * SkillItemHintStepper) and per-row in the cost-details popover.
 */
export function HintLevelStepper(props: Readonly<HintLevelStepperProps>) {
  const { level: rawLevel, onChange, disabled = false, className } = props;

  const level = clampLevel(rawLevel);
  const label = getStepLabel(level);
  const off = `${getHintDiscountPercent(level)}%`;

  const setLevel = (next: number) => {
    const clamped = clampLevel(next);
    if (clamped !== level) {
      onChange(clamped);
    }
  };

  const atMin = disabled || level <= MIN_HINT_LEVEL;
  const atMax = disabled || level >= MAX_HINT_LEVEL;

  return (
    <div
      className={cn(
        'inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-border bg-muted/30',
        className
      )}
      title={`Hint ${label} · ${off} off`}
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

      <div className="flex h-full items-center justify-center gap-1.5 border-x border-border px-2">
        <span className="text-xs font-semibold leading-none">{label}</span>
        {level > 0 && (
          <span
            // Light `--primary` (#66bf0d) only clears ~2.3:1 on the light control
            // surface — below AA for this small text. Use a deeper green in light
            // mode; dark `--primary` (#57a112) already passes on charcoal.
            className="font-mono text-[11px] font-semibold leading-none text-[#2f6b09] dark:text-primary"
          >
            {off}
          </span>
        )}
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

type SkillItemHintStepperProps = {
  className?: string;
};

/**
 * Context-wired stepper for a skill card. Reads the current level from the
 * shared SkillItem context and writes through the same `onHintLevelChange`
 * action the cost popover uses, so both stay in sync.
 *
 * Renders nothing when hint tuning does not apply: no `onHintLevelChange`
 * handler, the skill has no purchasable cost (e.g. unique skills), or the
 * skill is already obtained (cost 0, hint irrelevant).
 */
export function SkillItemHintStepper(props: Readonly<SkillItemHintStepperProps>) {
  const { className } = props;
  const { skillId, getSkillMeta, onHintLevelChange, costSummary, hasCost } = useSkillItem();

  const meta = useMemo(() => getSkillMeta(skillId), [getSkillMeta, skillId]);
  const isObtained = costSummary?.isObtained ?? meta.bought ?? false;

  if (!onHintLevelChange || !hasCost || isObtained) {
    return null;
  }

  return (
    <HintLevelStepper
      level={clampLevel(meta.hintLevel)}
      onChange={(level) => onHintLevelChange(skillId, level)}
      className={className}
    />
  );
}
