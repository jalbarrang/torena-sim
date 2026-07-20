import { memo } from 'react';
import { RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import {
  resetTeamTrialsSheetOverrides,
  setTeamTrialsSheetOverride
} from '@/store/team-trials.store';
import type { Roster } from '../model/types';
import type { MemberRaceRow, RaceSheet, SheetResult } from '../model/score-sheet';
import { RaceSection } from './score-sheet-race';

const HEAD_CELL = 'px-2 py-1.5 font-medium';

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
      <div className="flex items-baseline justify-between gap-2 border-b px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold">Score sheet — edit the cells, totals follow</h2>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => resetTeamTrialsSheetOverrides()}
          className="text-muted-foreground"
        >
          reset sheet
          <RotateCcwIcon data-icon="inline-end" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b text-left text-[10.5px] font-medium text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card py-1.5 pl-3.5 pr-2 font-medium">Member</th>
              <th className={HEAD_CELL}>Place</th>
              <th className={HEAD_CELL}>Margin</th>
              <th className={HEAD_CELL}>White</th>
              <th className={HEAD_CELL}>Gold</th>
              <th className={HEAD_CELL}>Inherit</th>
              <th className={HEAD_CELL} title="Good positioning phases, +1,000 each (max 3)">
                Pos
              </th>
              <th className="px-2 py-1.5 text-right font-medium">Uniq</th>
              <th className={HEAD_CELL}>Time</th>
              <th className={HEAD_CELL} title="Fast start, +1,000">
                Fast
              </th>
              <th className={HEAD_CELL} title="Long shot win, +4,000 (winner only)">
                LS
              </th>
              <th className={HEAD_CELL} title="Rushed, −500">
                Rush
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
                <span className="sticky left-3.5 inline-block">
                  Match win{' '}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    won {wonCount} of {result.races.length} races
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
