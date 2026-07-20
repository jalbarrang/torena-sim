import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MAX_LEVEL, MIN_LEVEL } from '@/store/trainee-list.store';

const LEVELS = [1, 2, 3, 4, 5] as const;

type LevelPipsProps = {
  label: string;
  value: number;
  /** Lowest selectable level (e.g. a card's base rarity for stars). Pips below render locked. */
  min?: number;
  readOnly?: boolean;
  onChange?: (value: number) => void;
  renderIcon: (filled: boolean) => ReactNode;
};

export const LevelPips = (props: LevelPipsProps) => {
  const { label, value, min = MIN_LEVEL, readOnly = false, onChange, renderIcon } = props;

  const pipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (readOnly) {
    return (
      <div
        className="flex items-center justify-center gap-0.5"
        role="img"
        aria-label={`${label}: ${value} of ${MAX_LEVEL}`}
      >
        {LEVELS.map((level) => (
          <span key={level} className="flex size-5 items-center justify-center">
            {renderIcon(level <= value)}
          </span>
        ))}
      </div>
    );
  }

  const commit = (level: number) => {
    const next = Math.min(MAX_LEVEL, Math.max(min, level));
    onChange?.(next);
    pipRefs.current[next - 1]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        event.preventDefault();
        commit(value - 1);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        event.preventDefault();
        commit(value + 1);
        break;
      case 'Home':
        event.preventDefault();
        commit(min);
        break;
      case 'End':
        event.preventDefault();
        commit(MAX_LEVEL);
        break;
    }
  };

  return (
    <div className="flex items-center justify-center gap-0.5" role="radiogroup" aria-label={label}>
      {LEVELS.map((level) => {
        const locked = level < min;
        const checked = level === value;

        return (
          <button
            key={level}
            ref={(node) => {
              pipRefs.current[level - 1] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${label} ${level}`}
            disabled={locked}
            tabIndex={checked ? 0 : -1}
            onClick={() => commit(level)}
            onKeyDown={handleKeyDown}
            className={cn(
              'flex size-5 items-center justify-center rounded-sm outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring/60',
              locked ? 'cursor-default' : 'cursor-pointer hover:bg-accent'
            )}
          >
            {renderIcon(level <= value)}
          </button>
        );
      })}
    </div>
  );
};
