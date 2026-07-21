import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { SheetMultipliers, SheetResult } from '../model/score-sheet';
import { WINSTREAK_BONUS_PCTS } from '../model/scoring-tables';
import { setTeamTrialsMultipliers } from '@/store/team-trials.store';
import { useCommittedNumberInput } from './committed-number-input';

const CAMPAIGN_OPTIONS = [1, 1.5, 2, 3] as const;

export function aceBonusExplanation(aceCount: number) {
  return aceCount > 0 ? 'already included in ace rows' : 'no ace in roster';
}

const inputClass =
  'h-7 rounded-md px-1.5 text-right font-mono text-[11px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none pointer-coarse:h-11';

type RatingInputProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

export function RatingInput(props: RatingInputProps) {
  const { label, value, onChange } = props;
  const input = useCommittedNumberInput({ value, emptyWhenZero: true, onCommit: onChange });

  return (
    <Input
      type="number"
      min={0}
      step={1000}
      aria-label={label}
      placeholder="—"
      {...input}
      className={`${inputClass} w-24`}
    />
  );
}

type MultipliersPanelProps = {
  aceCount: number;
  multipliers: SheetMultipliers;
  result: SheetResult;
};

export function MultipliersPanel(props: MultipliersPanelProps) {
  const { aceCount, multipliers, result } = props;

  const set = (patch: Partial<SheetMultipliers>) =>
    setTeamTrialsMultipliers({ ...multipliers, ...patch });

  const afterBonus = Math.round(result.totalBeforeGlobal * result.bonusMultiplier);
  const afterOpponent = Math.round(afterBonus * result.opponentFactor);

  return (
    <section
      data-tutorial="team-trials-multipliers"
      className="flex flex-col overflow-hidden rounded-xl border bg-card"
    >
      <h2 className="border-b px-3.5 py-2.5 text-[13px] font-semibold">Multipliers</h2>

      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Support bonus
          <span className="flex items-center gap-1 text-foreground">
            <Input
              type="number"
              min={0}
              step={1}
              aria-label="Support bonus percent"
              value={multipliers.supportBonusPct}
              onChange={(event) =>
                set({ supportBonusPct: Math.max(0, Number(event.target.value) || 0) })
              }
              className={`${inputClass} w-14`}
            />
            %
          </span>
        </div>
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          Collection-wide, per owned support card: lv 50/45 → +5% · lv 40 → +3% · lv 25–35 → +2% ·
          lv 20 → +1%
        </p>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Winstreak bonus
          <Select
            value={String(multipliers.winstreakBonusPct)}
            onValueChange={(value) =>
              set({ winstreakBonusPct: Number(value) as SheetMultipliers['winstreakBonusPct'] })
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Winstreak bonus"
              className="h-7 w-18 px-1.5 text-[11px] pointer-coarse:h-11"
            >
              <SelectValue>
                {multipliers.winstreakBonusPct === 0 ? '0%' : `+${multipliers.winstreakBonusPct}%`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="text-xs">
              {WINSTREAK_BONUS_PCTS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option === 0 ? '0%' : `+${option}%`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Your team rating
          <RatingInput
            label="Your team rating"
            value={multipliers.ownRating}
            onChange={(value) => set({ ownRating: value })}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Opponent team rating
          <RatingInput
            label="Opponent team rating"
            value={multipliers.opponentRating}
            onChange={(value) => set({ opponentRating: value })}
          />
        </div>
        <p className="text-[10.5px] leading-snug text-muted-foreground">
          Opponent bonus = opp ÷ (own + 200,000 − opp), usually ×1.1–1.2. Leave blank for ×1.
        </p>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Score-up campaign
          <Select
            value={String(multipliers.campaignMultiplier)}
            onValueChange={(value) =>
              set({ campaignMultiplier: Number(value) as SheetMultipliers['campaignMultiplier'] })
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Score-up campaign multiplier"
              className="h-7 w-18 px-1.5 text-[11px] pointer-coarse:h-11"
            >
              <SelectValue>×{multipliers.campaignMultiplier}</SelectValue>
            </SelectTrigger>
            <SelectContent className="text-xs">
              {CAMPAIGN_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  ×{option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t px-3.5 py-3 font-mono text-xs tabular-nums">
        <div className="flex justify-between text-muted-foreground">
          <span className="font-sans">Base score (sheet)</span>
          <span className="font-semibold text-foreground">
            {result.totalBeforeGlobal.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span className="font-sans">
            Ace +10% <span>({aceBonusExplanation(aceCount)})</span>
          </span>
          <span>—</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span className="font-sans">
            × (1 + {multipliers.supportBonusPct}% + {multipliers.winstreakBonusPct}%)
          </span>
          <span className="font-semibold text-foreground">{afterBonus.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span className="font-sans">× opponent rating ×{result.opponentFactor.toFixed(3)}</span>
          <span className="font-semibold text-foreground">{afterOpponent.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span className="font-sans">× campaign</span>
          <span>×{multipliers.campaignMultiplier}</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
          <span className="font-sans">Projected run total</span>
          <span className="text-success">{result.total.toLocaleString()}</span>
        </div>
      </div>
    </section>
  );
}
