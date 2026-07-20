import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { MarginTier, MemberRaceRow, RaceResult, RaceSheet } from '../model/score-sheet';
import { GOOD_POSITIONING_MAX_PHASES } from '../model/scoring-tables';
import {
  MARGIN_LABELS,
  MARGIN_TIERS,
  PLACES,
  placeLabel,
  subtotalNote
} from './score-sheet-format';
import { CATEGORY_LABELS, CATEGORY_RANGES } from './team-column';

const numberCellClass =
  'h-6 w-11 rounded-md border bg-muted/50 px-1.5 text-right font-mono text-[11px] tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-8';

type NumberCellProps = {
  label: string;
  value: number;
  max?: number;
  wide?: boolean;
  onChange: (value: number) => void;
};

function NumberCell(props: NumberCellProps) {
  const { label, value, max, wide = false, onChange } = props;

  return (
    <input
      type="number"
      min={0}
      max={max}
      aria-label={label}
      value={value}
      onChange={(event) => {
        const parsed = Math.max(0, Math.floor(Number(event.target.value) || 0));
        onChange(max === undefined ? parsed : Math.min(max, parsed));
      }}
      className={cn(numberCellClass, wide && 'w-14')}
    />
  );
}

type RaceSectionProps = {
  sheet: RaceSheet;
  race: RaceResult;
  umasById: Map<string, UmaSearchEntry>;
  updateRow: (sheet: RaceSheet, outfitId: string, patch: Partial<MemberRaceRow>) => void;
};

export function RaceSection(props: RaceSectionProps) {
  const { sheet, race, umasById, updateRow } = props;

  return (
    <>
      <tr className="border-t bg-muted/25">
        <td
          colSpan={13}
          className="py-1 pl-3.5 pr-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          <span className="sticky left-3.5 inline-block">
            {CATEGORY_LABELS[sheet.category]} · {CATEGORY_RANGES[sheet.category]}
          </span>
        </td>
      </tr>
      {sheet.rows.map((row) => {
        const memberScore = race.members.find((member) => member.outfitId === row.outfitId);
        const name = umasById.get(row.outfitId)?.name ?? row.outfitId;
        const isAce = (memberScore?.aceBonusPoints ?? 0) > 0;

        return (
          <tr key={row.outfitId} className="border-t border-border/45">
            <td className="sticky left-0 z-10 max-w-32 truncate bg-card py-1 pl-3.5 pr-2 font-medium sm:max-w-40">
              {name}
              {isAce && (
                <span className="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  ▸ace
                </span>
              )}
            </td>
            <td className="px-2 py-1">
              <Select
                value={String(row.place)}
                onValueChange={(value) => updateRow(sheet, row.outfitId, { place: Number(value) })}
              >
                <SelectTrigger size="sm" className="h-6 w-16 px-1.5 text-[11px] pointer-coarse:h-8">
                  <SelectValue>{placeLabel(row.place)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="text-xs">
                  {PLACES.map((place) => (
                    <SelectItem key={place} value={String(place)}>
                      {placeLabel(place)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </td>
            <td className="px-2 py-1">
              {row.place === 1 ? (
                <Select
                  value={row.marginTier ?? 'oneLength'}
                  onValueChange={(value) =>
                    updateRow(sheet, row.outfitId, { marginTier: value as MarginTier })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="h-6 w-16 px-1.5 text-[11px] pointer-coarse:h-8"
                  >
                    <SelectValue>{MARGIN_LABELS[row.marginTier ?? 'oneLength']}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    {MARGIN_TIERS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {MARGIN_LABELS[tier]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="pl-1.5 text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-2 py-1">
              <NumberCell
                label={`white skill procs for ${name}`}
                value={row.whiteProcs}
                onChange={(value) => updateRow(sheet, row.outfitId, { whiteProcs: value })}
              />
            </td>
            <td className="px-2 py-1">
              <NumberCell
                label={`gold skill procs for ${name}`}
                value={row.goldProcs}
                onChange={(value) => updateRow(sheet, row.outfitId, { goldProcs: value })}
              />
            </td>
            <td className="px-2 py-1">
              <NumberCell
                label={`inherited skill procs for ${name}`}
                value={row.inheritedProcs}
                onChange={(value) => updateRow(sheet, row.outfitId, { inheritedProcs: value })}
              />
            </td>
            <td className="px-2 py-1">
              <NumberCell
                label={`good positioning phases for ${name}`}
                value={row.goodPositioningPhases}
                max={GOOD_POSITIONING_MAX_PHASES}
                onChange={(value) =>
                  updateRow(sheet, row.outfitId, { goodPositioningPhases: value })
                }
              />
            </td>
            <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
              {memberScore?.uniqueProcPoints.toLocaleString() ?? '—'}
            </td>
            <td className="px-2 py-1">
              <NumberCell
                label={`time bonus for ${name}`}
                value={row.timeBonus}
                max={2000}
                wide
                onChange={(value) => updateRow(sheet, row.outfitId, { timeBonus: value })}
              />
            </td>
            <td className="px-2 py-1">
              <Checkbox
                aria-label={`fast start for ${name}`}
                checked={row.fastStart}
                onCheckedChange={(checked) =>
                  updateRow(sheet, row.outfitId, { fastStart: checked === true })
                }
              />
            </td>
            <td className="px-2 py-1">
              <Checkbox
                aria-label={`long shot win for ${name}`}
                checked={row.longShot && row.place === 1}
                disabled={row.place !== 1}
                onCheckedChange={(checked) =>
                  updateRow(sheet, row.outfitId, { longShot: checked === true })
                }
              />
            </td>
            <td className="px-2 py-1">
              <Checkbox
                aria-label={`rushed for ${name}`}
                checked={row.rushed}
                onCheckedChange={(checked) =>
                  updateRow(sheet, row.outfitId, { rushed: checked === true })
                }
              />
            </td>
            <td className="py-1 pl-2 pr-3.5 text-right font-mono font-semibold tabular-nums">
              {memberScore?.totalBeforeGlobal.toLocaleString() ?? '—'}
            </td>
          </tr>
        );
      })}
      <tr className="border-t bg-muted/40 font-semibold">
        <td colSpan={12} className="py-1.5 pl-3.5 pr-2">
          <span className="sticky left-3.5 inline-block">
            {CATEGORY_LABELS[sheet.category]} subtotal{' '}
            <span className="text-[11px] font-normal text-muted-foreground">
              {subtotalNote(race, sheet.rows)}
            </span>
          </span>
        </td>
        <td className="py-1.5 pl-2 pr-3.5 text-right font-mono tabular-nums">
          {race.totalBeforeGlobal.toLocaleString()}
        </td>
      </tr>
    </>
  );
}
