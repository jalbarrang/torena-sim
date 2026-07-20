import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Trash2Icon, UsersIcon, WandSparklesIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useUmasForSearch } from '@/modules/runners/utils';
import { useTraineeListStore } from '@/store/trainee-list.store';
import {
  applyTeamTrialsSheetOverrides,
  clearTeamTrialsRoster,
  setTeamTrialsAssignments,
  setTeamTrialsClass,
  useTeamTrialsStore
} from '@/store/team-trials.store';
import { optimizeRoster } from '../model/optimizer';
import { ROSTER_CATEGORIES } from '../model/types';
import type { RosterCategory } from '../model/types';
import { buildRoster } from '../model/roster';
import { computeSheet } from '../model/score-sheet';
import { TEAM_SIZE_BY_CLASS } from '../model/scoring-tables';
import { AddMemberDialog } from './add-member-dialog';
import { MultipliersPanel } from './multipliers-panel';
import { ScoreSheet } from './score-sheet';
import { TeamColumn } from './team-column';

const TEAM_CLASSES = [6, 5, 4, 3, 2, 1] as const;

type StatCardProps = {
  value: string;
  caption: string;
  highlight?: boolean;
};

function StatCard(props: StatCardProps) {
  const { value, caption, highlight = false } = props;

  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <div
        className={cn(
          'font-mono text-lg font-semibold tabular-nums leading-tight',
          highlight && 'text-emerald-600 dark:text-emerald-400'
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{caption}</div>
    </div>
  );
}

export function TeamTrialsPage() {
  const owned = useTraineeListStore((state) => state.owned);
  const teamClass = useTeamTrialsStore((state) => state.teamClass);
  const assignments = useTeamTrialsStore((state) => state.assignments);
  const aces = useTeamTrialsStore((state) => state.aces);
  const multipliers = useTeamTrialsStore((state) => state.multipliers);
  const sheetOverrides = useTeamTrialsStore((state) => state.sheetOverrides);
  const umas = useUmasForSearch(false);

  const [addCategory, setAddCategory] = useState<RosterCategory | null>(null);

  const ownedCount = Object.keys(owned).length;
  const teamSize = TEAM_SIZE_BY_CLASS[teamClass];
  const slotCount = teamSize * ROSTER_CATEGORIES.length;

  const umasById = useMemo(() => new Map(umas.map((uma) => [uma.id, uma])), [umas]);

  const roster = useMemo(
    () => buildRoster({ assignments, aces, umas, owned, teamSize }),
    [assignments, aces, umas, owned, teamSize]
  );

  const sheets = useMemo(
    () => applyTeamTrialsSheetOverrides(roster, sheetOverrides),
    [roster, sheetOverrides]
  );

  const result = useMemo(
    () => computeSheet(roster, sheets, multipliers),
    [roster, sheets, multipliers]
  );

  const members = ROSTER_CATEGORIES.flatMap((category) => roster[category]);
  const rosteredCount = members.length;
  const perfectFitCount = members.filter((member) => {
    const aptitudes = umasById.get(member.outfitId)?.aptitudes;
    if (!aptitudes) return false;

    const surface = aptitudes[member.surface as keyof typeof aptitudes];
    const distance = aptitudes[member.distance as keyof typeof aptitudes];
    return (surface === 'A' || surface === 'S') && (distance === 'A' || distance === 'S');
  }).length;

  // One roster slot per character: outfits of already-rostered characters can't be added again.
  const addCandidates = useMemo(() => {
    const usedCharacters = new Set(
      ROSTER_CATEGORIES.flatMap((category) => roster[category].map((member) => member.charId))
    );
    return umas.filter((uma) => owned[uma.id] && !usedCharacters.has(uma.id.slice(0, 4)));
  }, [umas, owned, roster]);

  const autoFill = () => {
    const optimized = optimizeRoster({ umas, owned, teamSize, pinned: {}, excluded: [] });

    setTeamTrialsAssignments(
      Object.fromEntries(
        ROSTER_CATEGORIES.map((category) => [
          category,
          optimized[category].map((member) => member.outfitId)
        ])
      )
    );
  };

  if (ownedCount === 0) {
    return (
      <div className="flex w-full items-center justify-center px-4 py-4">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No owned trainees yet</EmptyTitle>
            <EmptyDescription>
              Team members are picked from the trainees you own. Mark them in the{' '}
              <Link to="/trainee-list">Trainee List</Link> first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="w-full min-h-0 overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-4 py-4 pb-12">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Team Trials</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Build your roster from your Trainee List ({ownedCount} owned) — one slot per uma
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={String(teamClass)}
              onValueChange={(value) => setTeamTrialsClass(Number(value) as typeof teamClass)}
            >
              <SelectTrigger size="sm" className="w-auto min-w-36 text-xs pointer-coarse:h-8">
                <SelectValue>
                  Class {teamClass} · {TEAM_SIZE_BY_CLASS[teamClass]} per team
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="text-xs">
                {TEAM_CLASSES.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    Class {value} · {TEAM_SIZE_BY_CLASS[value]} per team
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={autoFill}>
              <WandSparklesIcon />
              Auto-fill
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => clearTeamTrialsRoster()}
              disabled={rosteredCount === 0}
            >
              <Trash2Icon />
              Clear
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard
            value={`${rosteredCount} / ${slotCount}`}
            caption={`slots filled · ${ownedCount} owned`}
          />
          <StatCard
            value={`${perfectFitCount} of ${rosteredCount || slotCount} A/A`}
            caption="aptitude fit, no multiplier loss"
          />
          <StatCard
            value={result.totalBeforeGlobal.toLocaleString()}
            caption="base score from the sheet below"
          />
          <StatCard
            value={result.total.toLocaleString()}
            caption="projected run total after multipliers"
            highlight
          />
        </div>

        {/* Roster grid */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 min-[980px]:grid-cols-5">
          {ROSTER_CATEGORIES.map((category) => (
            <TeamColumn
              key={category}
              category={category}
              members={roster[category]}
              teamSize={teamSize}
              umasById={umasById}
              onAddMember={setAddCategory}
            />
          ))}
        </div>

        {/* Score sheet + multipliers */}
        {rosteredCount > 0 && (
          <div className="grid items-start gap-3 min-[980px]:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
            <ScoreSheet roster={roster} sheets={sheets} result={result} umasById={umasById} />
            <MultipliersPanel multipliers={multipliers} result={result} />
          </div>
        )}

        <AddMemberDialog
          category={addCategory}
          onOpenChange={(open) => {
            if (!open) setAddCategory(null);
          }}
          candidates={addCandidates}
          owned={owned}
        />
      </div>
    </div>
  );
}
