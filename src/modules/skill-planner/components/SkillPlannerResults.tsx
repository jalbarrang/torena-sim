import { useCallback, useMemo, useRef, useState } from 'react';
import { getObtainedSkills, useSkillPlannerStore } from '../skill-planner.store';
import { resolveActiveSkills } from '../optimizer';
import type { CombinationResult, OptimizationProgress, OptimizationResult } from '../types';
import { buildOptimizationInputFingerprint } from '../input-fingerprint';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SaveRunnerModal } from '@/modules/runners/components/save-runner-modal';
import {
  SkillItemActions,
  SkillItemBody,
  SkillItemIdentity,
  SkillItemMain,
  SkillItemRail,
  SkillItemRoot
} from '@/modules/skills/components/skill-list/skill-item/primitives';
import { SkillItemDetailsActions } from '@/modules/skills/components/skill-list/skill-item/actions';
import { SkillItem } from '@/modules/skills/components/skill-list/skill-item/item';
import { getCompareFieldId, setRunner } from '@/store/runners.store';
import { useRunnerLibraryStore } from '@/store/runner-library.store';
import { useSettingsStore } from '@/store/settings.store';
import { toast } from 'sonner';

type SkillPlannerResultsProps = React.HTMLAttributes<HTMLDivElement>;

function ResultSkillRow({ className }: Readonly<{ className?: string }>) {
  return (
    <SkillItemRoot className={className}>
      <SkillItemRail />
      <SkillItemBody className="p-1 px-2">
        <SkillItemMain>
          <SkillItemIdentity />
          <SkillItemActions>
            <SkillItemDetailsActions />
          </SkillItemActions>
        </SkillItemMain>
      </SkillItemBody>
    </SkillItemRoot>
  );
}

type OptimizationProgressCardProps = {
  progress: OptimizationProgress;
  progressPercentage: number;
};

function OptimizationProgressCard(props: Readonly<OptimizationProgressCardProps>) {
  const { progress, progressPercentage } = props;

  return (
    <div className="space-y-2 border rounded-lg p-4 bg-card">
      <div className="flex justify-between text-sm">
        <span>Testing combinations…</span>
        <span className="font-medium">
          {progress.completed} / {progress.total}
        </span>
      </div>
      <Progress value={progressPercentage} />
      {progress.currentBest && (
        <div className="text-xs text-muted-foreground mt-2">
          <p>Current best: +{progress.currentBest.bashin.toFixed(2)} Lengths</p>
          <p className="text-xs opacity-75">
            {progress.currentBest.skills.length} skills for {progress.currentBest.cost} pts
          </p>
        </div>
      )}
    </div>
  );
}

type CombinationCardProps = {
  combination: CombinationResult;
  budget: number;
  onOpenSaveModal: (combination: CombinationResult) => void;
  onSendToCompare: (slot: 'uma1' | 'uma2', combination: CombinationResult) => void;
};

function CombinationCard(props: Readonly<CombinationCardProps>) {
  const { combination, budget, onOpenSaveModal, onSendToCompare } = props;
  const bashinGain = combination.bashin;

  return (
    <div className="border rounded-lg p-3 bg-background">
      <div className="mb-2 space-y-1">
        {combination.skills.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No additional skills (baseline)</p>
        )}

        {combination.skills.map((skillId) => {
          const skillCost = combination.skillCosts[skillId] ?? 0;

          return (
            <div key={skillId} className="flex items-center gap-2">
              <SkillItem skillId={skillId}>
                <ResultSkillRow className="flex-1 border" />
              </SkillItem>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {skillCost} SP
              </span>
            </div>
          );
        })}
      </div>

      {combination.skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
          <Button size="sm" variant="secondary" onClick={() => onOpenSaveModal(combination)}>
            Save to Veterans
          </Button>

          <Button size="sm" variant="outline" onClick={() => onSendToCompare('uma1', combination)}>
            Uma 1
          </Button>

          <Button size="sm" variant="outline" onClick={() => onSendToCompare('uma2', combination)}>
            Uma 2
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 items-center pt-2 border-t text-xs">
        <div>
          <span className="text-muted-foreground">Total Cost: </span>
          <span className="font-medium">
            {combination.cost} / {budget} pts
          </span>
        </div>

        <div className="flex justify-end items-center gap-2">
          <div className="font-bold">
            {bashinGain > 0 ? '+' : ''}
            {bashinGain.toFixed(2)}
          </div>

          <div className="text-xs text-muted-foreground">Lengths</div>
        </div>
      </div>
    </div>
  );
}

type ResultsPanelProps = {
  result: OptimizationResult;
  rankedCombinations: Array<CombinationResult>;
  visibleCombinations: Array<CombinationResult>;
  visibleCount: number;
  budget: number;
  isResultStale: boolean;
  hasMore: boolean;
  onShowMore: () => void;
  onOpenSaveModal: (combination: CombinationResult) => void;
  onSendToCompare: (slot: 'uma1' | 'uma2', combination: CombinationResult) => void;
};

function ResultsPanel(props: Readonly<ResultsPanelProps>) {
  const {
    result,
    rankedCombinations,
    visibleCombinations,
    visibleCount,
    budget,
    isResultStale,
    hasMore,
    onShowMore,
    onOpenSaveModal,
    onSendToCompare
  } = props;

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="border-b bg-primary/10 p-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center gap-2">Simulation Complete</div>

          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>Combinations Tested: {result.simulationCount}</span>
            <span>Time Taken: {(result.timeTaken / 1000).toFixed(1)}s</span>
            <span>Results: {rankedCombinations.length}</span>
          </div>
        </div>
      </div>

      {isResultStale && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
          Settings changed since this result was generated. Re-run Optimize or Replay to apply
          current inputs.
        </div>
      )}

      <div className="flex flex-col flex-1">
        <div className="p-4 space-y-3">
          {rankedCombinations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No combinations found</p>
          )}

          {visibleCombinations.map((combination) => (
            <CombinationCard
              key={combination.skills.join('-')}
              combination={combination}
              budget={budget}
              onOpenSaveModal={onOpenSaveModal}
              onSendToCompare={onSendToCompare}
            />
          ))}
          {hasMore && (
            <Button variant="outline" className="w-full" onClick={onShowMore}>
              Load 5 more ({rankedCombinations.length - visibleCount} remaining)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type EmptyResultsProps = {
  canOptimize: boolean;
};

function EmptyResults(props: Readonly<EmptyResultsProps>) {
  const { canOptimize } = props;

  return (
    <div className="text-center text-muted-foreground py-8 border rounded-lg bg-muted/30">
      <p className="text-sm">Click "Optimize" to find the best skill combination</p>
      <p className="text-xs mt-2">
        {!canOptimize && 'Add candidate skills and set a budget to begin'}
      </p>
    </div>
  );
}

export function SkillPlannerResults(props: SkillPlannerResultsProps) {
  const { className, ...rest } = props;

  const {
    obtainedSkillIds,
    candidates,
    skillMetaById,
    budget,
    hasFastLearner,
    ignoreStaminaConsumption,
    isOptimizing,
    progress,
    result,
    runner,
    lastOptimizationFingerprint
  } = useSkillPlannerStore();
  const { courseId, racedef, staminaDrainOverrides } = useSettingsStore();
  const addRunner = useRunnerLibraryStore((state) => state.addRunner);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [selectedCombination, setSelectedCombination] = useState<CombinationResult | null>(null);
  const [visibleCount, setVisibleCount] = useState(5);
  const prevResultRef = useRef(result);

  if (prevResultRef.current !== result) {
    prevResultRef.current = result;
    setVisibleCount(5);
  }

  const candidateList = useMemo(() => Object.values(candidates), [candidates]);
  const canOptimize = candidateList.length > 0 && budget > 0;

  const progressPercentage = progress ? (progress.completed / progress.total) * 100 : 0;

  const rankedCombinations = useMemo(() => {
    if (!result?.allResults) return [];

    return result.allResults.toSorted((a, b) => b.bashin - a.bashin);
  }, [result]);

  const visibleCombinations = useMemo(
    () => rankedCombinations.slice(0, visibleCount),
    [rankedCombinations, visibleCount]
  );

  const hasMore = rankedCombinations.length > visibleCount;

  const currentInputFingerprint = useMemo(() => {
    return buildOptimizationInputFingerprint({
      budget,
      hasFastLearner,
      ignoreStaminaConsumption,
      courseId,
      racedef,
      runner,
      obtainedSkillIds,
      candidates,
      skillMetaById,
      staminaDrainOverrides
    });
  }, [
    budget,
    candidates,
    courseId,
    hasFastLearner,
    ignoreStaminaConsumption,
    obtainedSkillIds,
    racedef,
    runner,
    skillMetaById,
    staminaDrainOverrides
  ]);

  const isResultStale = useMemo(() => {
    if (!result || !lastOptimizationFingerprint) {
      return false;
    }

    return currentInputFingerprint !== lastOptimizationFingerprint;
  }, [currentInputFingerprint, lastOptimizationFingerprint, result]);

  const optimizationContext = useMemo(() => {
    if (!result) {
      return null;
    }

    const state = useSkillPlannerStore.getState();

    return {
      runner: {
        ...state.runner,
        skills: [...state.obtainedSkillIds]
      },
      obtainedSkills: getObtainedSkills()
    };
  }, [result]);

  const buildSkills = useCallback(
    (combination: CombinationResult): Array<string> => {
      const obtainedSkills = optimizationContext?.obtainedSkills ?? getObtainedSkills();

      return resolveActiveSkills(Array.from(new Set([...obtainedSkills, ...combination.skills])));
    },
    [optimizationContext]
  );

  const buildRunnerSnapshot = useCallback(
    (combination: CombinationResult) => {
      const baseRunner = optimizationContext?.runner ?? runner;

      return {
        ...baseRunner,
        skills: buildSkills(combination)
      };
    },
    [optimizationContext, runner, buildSkills]
  );

  const handleOpenSaveModal = useCallback((combination: CombinationResult) => {
    setSelectedCombination(combination);
    setSaveModalOpen(true);
  }, []);

  const handleSaveModalOpenChange = useCallback((open: boolean) => {
    setSaveModalOpen(open);

    if (!open) {
      setSelectedCombination(null);
    }
  }, []);

  const handleSaveToVeterans = useCallback(
    (name: string) => {
      if (!selectedCombination) {
        return;
      }

      addRunner({
        ...buildRunnerSnapshot(selectedCombination),
        notes: name
      });

      setSelectedCombination(null);
    },
    [addRunner, buildRunnerSnapshot, selectedCombination]
  );

  const handleSendToCompare = useCallback(
    (slot: 'uma1' | 'uma2', combination: CombinationResult) => {
      setRunner(getCompareFieldId(slot), buildRunnerSnapshot(combination));
      toast.success(`Loaded build into ${slot === 'uma1' ? 'Uma 1' : 'Uma 2'}`);
    },
    [buildRunnerSnapshot]
  );

  return (
    <div className={cn('space-y-4', className)} {...rest}>
      <SaveRunnerModal
        open={saveModalOpen}
        onOpenChange={handleSaveModalOpenChange}
        onSave={(name) => handleSaveToVeterans(name)}
        showLinkOption={false}
      />

      {isOptimizing && progress && (
        <OptimizationProgressCard progress={progress} progressPercentage={progressPercentage} />
      )}

      {result && (
        <ResultsPanel
          result={result}
          rankedCombinations={rankedCombinations}
          visibleCombinations={visibleCombinations}
          visibleCount={visibleCount}
          budget={budget}
          isResultStale={isResultStale}
          hasMore={hasMore}
          onShowMore={() => setVisibleCount((prev) => prev + 5)}
          onOpenSaveModal={handleOpenSaveModal}
          onSendToCompare={handleSendToCompare}
        />
      )}

      {!result && !isOptimizing && <EmptyResults canOptimize={canOptimize} />}
    </div>
  );
}
