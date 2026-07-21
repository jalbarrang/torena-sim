import { memo } from 'react';
import { CircleHelpIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import {
  resetTeamTrialsSheetOverrides,
  setTeamTrialsSheetOverride
} from '@/store/team-trials.store';
import type { Roster } from '../model/types';
import type { MemberRaceRow, RaceSheet, SheetResult } from '../model/score-sheet';
import { RaceSection } from './score-sheet-race';

const HEAD_CELL = 'px-2 py-1.5 font-medium';

type ScoreRuleHelpProps = {
  label: string;
  children: string;
};

function ScoreRuleHelp(props: ScoreRuleHelpProps) {
  const { label, children } = props;

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={`Explain ${label}`}
        className="inline-flex min-h-7 items-center gap-0.5 rounded-sm text-left underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <CircleHelpIcon aria-hidden="true" className="size-3 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

type ScoreSheetProps = {
  roster: Roster;
  sheets: Array<RaceSheet>;
  result: SheetResult;
  umasById: Map<string, UmaSearchEntry>;
};

export const ScoreSheet = memo((props: ScoreSheetProps) => {
  const { roster, sheets, result, umasById } = props;

  const updateRow = (sheet: RaceSheet, outfitId: string, patch: Partial<MemberRaceRow>) => {
    const rows = sheet.rows.map((row) => {
      if (row.outfitId !== outfitId) return row;

      const next = { ...row, ...patch };
      // Margin and long shot only apply to the race winner; clear them when the place moves off 1st.
      if (next.place !== 1) {
        next.marginTier = null;
        next.longShot = false;
      }
      if (next.place === 1 && next.marginTier === null) next.marginTier = 'oneLength';
      return next;
    });

    setTeamTrialsSheetOverride(sheet.category, rows, roster);
  };

  const wonCount = result.races.filter((race) => race.won).length;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-2 border-b px-3.5 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold">Score sheet</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Edit cells; totals recalculate. Help icons explain score rules.
          </p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => resetTeamTrialsSheetOverrides()}
          className="text-muted-foreground pointer-coarse:h-11"
        >
          reset sheet
          <RotateCcwIcon data-icon="inline-end" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b text-left text-[10.5px] font-medium text-muted-foreground">
              <th className="sticky left-0 z-10 border-r bg-card py-1.5 pl-3.5 pr-2 font-medium">
                Member
              </th>
              <th className={HEAD_CELL}>Place</th>
              <th className={HEAD_CELL}>Margin</th>
              <th className={HEAD_CELL}>White</th>
              <th className={HEAD_CELL}>Gold</th>
              <th className={HEAD_CELL}>Inherit</th>
              <th className={HEAD_CELL}>
                <ScoreRuleHelp label="Pos">
                  Good positioning: +1,000 for each applicable early, mid, or late phase (max 3).
                </ScoreRuleHelp>
              </th>
              <th className="px-2 py-1.5 text-right font-medium">
                <ScoreRuleHelp label="Uniq">
                  Unique skill activation points. Read-only; calculated from the outfit&apos;s base
                  rarity and owned star level.
                </ScoreRuleHelp>
              </th>
              <th className={HEAD_CELL}>Time</th>
              <th className={HEAD_CELL}>
                <ScoreRuleHelp label="Fast">Fast start: +1,000 when it occurs.</ScoreRuleHelp>
              </th>
              <th className={HEAD_CELL}>
                <ScoreRuleHelp label="LS">
                  Long-shot win: +4,000 only when the member finishes 1st.
                </ScoreRuleHelp>
              </th>
              <th className={HEAD_CELL}>
                <ScoreRuleHelp label="Rush">Rushed (kakari): −500 when it occurs.</ScoreRuleHelp>
              </th>
              <th className="py-1.5 pl-2 pr-3.5 text-right font-medium">Row pts</th>
            </tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => {
              const race = result.races.find((entry) => entry.category === sheet.category);
              if (!race || sheet.rows.length === 0) return null;

              return (
                <RaceSection
                  key={sheet.category}
                  sheet={sheet}
                  race={race}
                  umasById={umasById}
                  updateRow={updateRow}
                />
              );
            })}
            <tr className="border-t bg-muted/40 font-semibold">
              <td colSpan={12} className="py-1.5 pl-3.5 pr-2">
                <span className="sticky left-0 inline-block border-r bg-muted/40 py-1.5 pl-3.5 pr-2">
                  Match win{' '}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    won {wonCount} of {result.races.length} races · 3+ wins = +10,000
                  </span>
                </span>
              </td>
              <td className="py-1.5 pl-2 pr-3.5 text-right font-mono tabular-nums">
                {result.matchWinPoints > 0 ? result.matchWinPoints.toLocaleString() : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
});
