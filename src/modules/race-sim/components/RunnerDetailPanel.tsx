import { useCallback, useMemo, useState } from 'react';
import { PlusIcon, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { skillsService } from '@/modules/data/services/SkillService';
import { AptitudeBucketsField } from '@/modules/runners/components/aptitude-buckets-field';
import {
  StatsTable,
  type StatsKey
} from '@/modules/runners/components/runner-card/presentation/stats-table';
import { reconcileRunawayOnSkillsChange } from '@/modules/runners/components/runner-card/domain/runaway-policy';
import type { IRunnerState } from '@/modules/runners/components/runner-card/domain/runner-state';
import { UmaSelector } from '@/modules/runners/components/runner-selector';
import { getUmaDisplayInfo, getUmaImageUrl } from '@/modules/runners/utils';
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
import { openSkillPicker, updateCurrentSkills } from '@/modules/skills/store';
import { getSelectableSkillsForUma, getUniqueSkillForByUmaId } from '@/modules/skills/utils';
import { updateRunner, useRaceSimStore } from '@/modules/simulation/stores/race-sim.store';
import { useSettingsStore } from '@/store/settings.store';
import { rankLabel } from '@/modules/race-sim/rank-badge';
import { estimateRunnerRankScore } from '@/modules/race-sim/eval/rank-score';
import { computeFieldPopularity } from '@/modules/race-sim/eval/popularity';
import { cn } from '@/lib/utils';

type RunnerDetailPanelProps = {
  runnerIndex: number;
  totalRunners: number;
  onNavigate: (index: number) => void;
};

function RaceSimDetailSkillRow({ dismissable }: Readonly<{ dismissable: boolean }>) {
  return (
    <SkillItemRoot>
      <SkillItemRail />
      <SkillItemBody className="p-1 px-2">
        <SkillItemMain>
          <SkillItemIdentity />
          <SkillItemActions>
            <SkillItemDetailsActions dismissable={dismissable} />
          </SkillItemActions>
        </SkillItemMain>
      </SkillItemBody>
    </SkillItemRoot>
  );
}

export function RunnerDetailPanel({
  runnerIndex,
  totalRunners,
  onNavigate
}: Readonly<RunnerDetailPanelProps>) {
  const runner = useRaceSimStore((state) => {
    if (runnerIndex < 0 || runnerIndex >= state.runners.length) return null;
    return state.runners[runnerIndex];
  });
  const courseId = useSettingsStore((state) => state.courseId);
  const allRunners = useRaceSimStore((state) => state.runners);

  // Auto popularity (人気) order for the whole field, so the override control can
  // show the effective rank a runner gets when left on "Auto".
  const autoPopularity = useMemo(
    () => computeFieldPopularity(allRunners)[runnerIndex],
    [allRunners, runnerIndex]
  );

  const runnerDisplayName = useMemo(() => {
    if (!runner) return 'Runner';
    if (!runner.outfitId) return `Mob ${runnerIndex + 1}`;
    const displayInfo = getUmaDisplayInfo(runner.outfitId);
    return displayInfo ? `${displayInfo.name}` : 'Selected Runner';
  }, [runner, runnerIndex]);

  const outfitName = useMemo(() => {
    if (!runner?.outfitId) return null;
    const displayInfo = getUmaDisplayInfo(runner.outfitId);
    return displayInfo?.outfit ?? null;
  }, [runner?.outfitId]);

  const imageUrl = useMemo(
    () => getUmaImageUrl(runner?.outfitId, runner?.randomMobId),
    [runner?.outfitId, runner?.randomMobId]
  );

  const applyRunnerPatch = useCallback(
    (partial: Partial<IRunnerState>) => {
      updateRunner(runnerIndex, partial);
    },
    [runnerIndex]
  );

  const handleUpdateStat = useCallback(
    (stat: StatsKey) => (value: number) => {
      applyRunnerPatch({ [stat]: value });
    },
    [applyRunnerPatch]
  );

  const handleSetSkills = useCallback(
    (skills: Array<string>) => {
      if (!runner) return;
      const reconciled = reconcileRunawayOnSkillsChange(skills, runner.strategy);
      applyRunnerPatch({ skills: reconciled.skills, strategy: reconciled.strategy });
      updateCurrentSkills(reconciled.skills);
    },
    [applyRunnerPatch, runner]
  );

  const handleChangeRunner = useCallback(
    (outfitId: string) => {
      if (!runner) return;
      const keptSkills = runner.skills.filter((skillId) => {
        const baseSkillId = skillId.split('-', 1)[0] ?? skillId;
        const skillData = skillsService.getById(baseSkillId);
        return Boolean(skillData?.rarity && skillData.rarity < 3);
      });
      if (outfitId) {
        keptSkills.push(getUniqueSkillForByUmaId(outfitId));
      }
      applyRunnerPatch({ outfitId, skills: keptSkills });
    },
    [applyRunnerPatch, runner]
  );

  const handleOpenSkillPicker = useCallback(() => {
    if (!runner) return;
    openSkillPicker({
      runnerId: `race-sim-runner-${runnerIndex}`,
      umaId: runner.outfitId,
      options: getSelectableSkillsForUma(runner.outfitId, true),
      currentSkills: runner.skills,
      onSelect: handleSetSkills
    });
  }, [handleSetSkills, runner, runnerIndex]);

  const handleRemoveSkill = useCallback(
    (skillId: string) => {
      if (!runner) return;
      handleSetSkills(runner.skills.filter((id) => id !== skillId));
    },
    [handleSetSkills, runner]
  );

  const handleSetTeam = useCallback(
    (value: string | undefined) => {
      applyRunnerPatch({ team: value && value !== 'none' ? Number(value) : null });
    },
    [applyRunnerPatch]
  );

  const handleSetStar = useCallback(
    (value: string | undefined) => {
      applyRunnerPatch({ star: value && value !== 'none' ? Number(value) : null });
    },
    [applyRunnerPatch]
  );

  const handleSetPopularity = useCallback(
    (value: string | undefined) => {
      applyRunnerPatch({ popularity: value && value !== 'auto' ? Number(value) : null });
    },
    [applyRunnerPatch]
  );

  const uniqueSkillId = useMemo(() => {
    if (!runner?.outfitId) return null;
    return getUniqueSkillForByUmaId(runner.outfitId);
  }, [runner?.outfitId]);

  if (!runner) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <span className="text-sm">Invalid runner selection.</span>
      </div>
    );
  }

  const hasPrev = runnerIndex > 0;
  const hasNext = runnerIndex < totalRunners - 1;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-between border-b px-4 py-3 bg-card/50">
        <div className="flex items-center gap-3">
          <img
            src={imageUrl}
            alt={runnerDisplayName}
            className="size-10 rounded-md object-cover ring-1 ring-border"
          />
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              {runnerDisplayName}
              {runner.outfitId && (
                <span
                  className="rounded bg-primary/15 px-1 py-px text-[10px] font-semibold text-primary"
                  title={`${
                    typeof runner.rankScore === 'number' ? 'Rank' : 'Estimated rank'
                  } score ${estimateRunnerRankScore(runner)}`}
                >
                  {rankLabel(estimateRunnerRankScore(runner))}
                  {typeof runner.rankScore === 'number' ? '' : '*'}
                </span>
              )}
            </h2>
            {outfitName && (
              <p className="text-xs text-muted-foreground leading-tight">{outfitName}</p>
            )}

            {!outfitName && typeof runner.gate === 'number' && (
              <p className="text-xs text-muted-foreground leading-tight">Gate {runner.gate}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!hasPrev}
            onClick={() => onNavigate(runnerIndex - 1)}
          >
            <ChevronLeft />
          </Button>

          <span className="text-xs tabular-nums text-muted-foreground min-w-[3ch] text-center">
            {runnerIndex + 1}/{totalRunners}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={!hasNext}
            onClick={() => onNavigate(runnerIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto p-4 items-center">
        <div className="flex flex-col gap-4 p-4 border rounded max-w-2xl">
          <Section title="Runner">
            <UmaSelector
              value={runner.outfitId}
              select={handleChangeRunner}
              onReset={() => handleChangeRunner('')}
              randomMobId={runner.randomMobId}
            />
          </Section>

          {/* Star only affects the *estimated* rank score. It's irrelevant for
              imported runners (e.g. Hakuraku races — opponents copied from a real
              race) and for anyone carrying a real rankScore (used verbatim). */}
          {!runner.imported && typeof runner.rankScore !== 'number' && (
            <StarRating
              value={typeof runner.star === 'number' ? runner.star : 1}
              onChange={(star) => handleSetStar(String(star))}
              size="sm"
            />
          )}

          <Section title="Stats">
            <StatsTable value={runner} onChange={handleUpdateStat} />
          </Section>

          <Section title="Aptitudes & Style">
            <AptitudeBucketsField value={runner} onChange={applyRunnerPatch} courseId={courseId} />
          </Section>

          <Section title="Team">
            <ToggleGroup
              value={[typeof runner.team === 'number' ? String(runner.team) : 'none']}
              onValueChange={(value) => handleSetTeam(value[0])}
              variant="outline"
            >
              <ToggleGroupItem value="none">None</ToggleGroupItem>
              <ToggleGroupItem value="1">Team 1</ToggleGroupItem>
              <ToggleGroupItem value="2">Team 2</ToggleGroupItem>
              <ToggleGroupItem value="3">Team 3</ToggleGroupItem>
            </ToggleGroup>
          </Section>

          <Section title="Popularity">
            <ToggleGroup
              value={[typeof runner.popularity === 'number' ? String(runner.popularity) : 'auto']}
              onValueChange={(value) => handleSetPopularity(value[0])}
              variant="outline"
            >
              <ToggleGroupItem value="auto">
                Auto{typeof autoPopularity === 'number' ? ` (#${autoPopularity})` : ''}
              </ToggleGroupItem>
              {Array.from({ length: totalRunners }, (_, index) => index + 1).map((rank) => (
                <ToggleGroupItem key={rank} value={String(rank)}>
                  {rank}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>

          <Section
            title="Skills"
            action={
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleOpenSkillPicker}
              >
                <PlusIcon />
                Add Skills
              </Button>
            }
          >
            {runner.skills.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
                <Sparkles className="size-5 text-muted-foreground/50" />
                <div className="text-sm text-muted-foreground">No skills assigned yet.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7 text-xs gap-1"
                  onClick={handleOpenSkillPicker}
                >
                  <PlusIcon />
                  Browse Skills
                </Button>
              </div>
            )}

            {runner.skills.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {runner.skills.map((skillId) => (
                  <SkillItem key={skillId} skillId={skillId} onRemove={handleRemoveSkill}>
                    <RaceSimDetailSkillRow dismissable={skillId !== uniqueSkillId} />
                  </SkillItem>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function StarRating(
  props: Readonly<{
    value: number;
    onChange: (value: number) => void;
    size?: 'sm' | 'default';
  }>
) {
  const { value, onChange, size = 'default' } = props;

  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? value;

  const isSmall = size === 'sm';

  return (
    <div
      className={cn('flex items-center', isSmall ? 'gap-0' : 'gap-1')}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= active;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            aria-pressed={value === star}
            onMouseEnter={() => setHovered(star)}
            onClick={() => onChange(star)}
            className={cn(
              'rounded-sm text-muted-foreground transition-colors hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSmall ? 'p-px' : 'p-0.5'
            )}
          >
            <Star
              className={cn(
                'transition-colors',
                isSmall ? 'size-3.5' : 'size-6',
                filled ? 'fill-amber-400 text-amber-400' : 'fill-transparent'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  action,
  children
}: Readonly<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className={cn('text-xs font-semibold uppercase tracking-wider text-muted-foreground')}>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
