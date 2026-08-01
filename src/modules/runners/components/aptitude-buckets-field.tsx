import { useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { StrategySelect } from './StrategySelect';
import { MoodSelect } from './MoodSelect';
import { BucketAptitudesEditor } from './BucketAptitudesEditor';
import { reconcileRunawayOnStrategyChange } from './runner-card/domain/runaway-policy';
import type { IRunnerState } from './runner-card/domain/runner-state';
import { updateCurrentSkills } from '@/modules/skills/store';
import { strategyNames } from '@/lib/uma-domain/runner/definitions';
import type { IMood, IStrategyName } from '@/lib/uma-domain/runner/definitions';
import {
  bucketsFromRunner,
  collapsedFromBuckets,
  type AptitudeBucketKey
} from '@/modules/runners/aptitude-buckets';

type AptitudeBucketsFieldProps = {
  value: IRunnerState;
  onChange: (next: IRunnerState) => void;
  /** When set, collapsed grades resolve to this course; else best-grade max. */
  courseId?: number;
  /** Veteran/library editors hide strategy + mood (not race-specific). */
  showStrategyMood?: boolean;
};

export function AptitudeBucketsField({
  value,
  onChange,
  courseId,
  showStrategyMood = true
}: AptitudeBucketsFieldProps) {
  const handleBucketChange = useCallback(
    (key: AptitudeBucketKey, grade: string) => {
      const aptitudes = { ...bucketsFromRunner(value), [key]: grade };
      const collapsed = collapsedFromBuckets(aptitudes, value.strategy, courseId);
      onChange({ ...value, aptitudes, ...collapsed });
    },
    [onChange, value, courseId]
  );

  const handleStrategy = useCallback(
    (strategy: string | null) => {
      if (!strategy || !strategyNames.includes(strategy as IStrategyName)) return;
      const reconciled = reconcileRunawayOnStrategyChange(strategy as IStrategyName, value.skills);
      const next = {
        ...value,
        strategy: reconciled.strategy,
        skills: reconciled.skills
      } as IRunnerState;
      if (value.aptitudes) {
        Object.assign(next, collapsedFromBuckets(value.aptitudes, next.strategy, courseId));
      }
      onChange(next);
      if (reconciled.skills !== value.skills) {
        updateCurrentSkills(reconciled.skills);
      }
    },
    [onChange, value, courseId]
  );

  const handleMood = useCallback(
    (mood: IMood) => {
      onChange({ ...value, mood });
    },
    [onChange, value]
  );

  return (
    <div className="flex flex-col gap-3">
      <BucketAptitudesEditor value={bucketsFromRunner(value)} onChange={handleBucketChange} />

      {showStrategyMood && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-xl border">
            <Label className="w-16 pl-2 text-xs">Style:</Label>
            <StrategySelect value={value.strategy} onChange={handleStrategy} />
          </div>
          <div className="flex items-center gap-2 rounded-xl border">
            <Label className="w-16 pl-2 text-xs">Mood:</Label>
            <MoodSelect value={value.mood} onChange={handleMood} />
          </div>
        </div>
      )}
    </div>
  );
}
