import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { formatCarats } from '@/modules/carat/components/banner-plan-format';
import { bannerPickupTargets } from '@/modules/carat/data/card-names';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import {
  setPullResultPickupCopies,
  setPullResultPulls,
  setPullResultTicketsUsed
} from '@/store/carat.store';
import { cn } from '@/lib/utils';

type BannerPullResultFieldsProps = {
  row: BannerPlanRow;
  section: 'pulls' | 'tickets' | 'copies';
  className?: string;
};

function normalizeInput(value: string) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function BannerPullResultFields(props: BannerPullResultFieldsProps) {
  const { row, section, className } = props;
  const idPrefix = useId();
  const result = row.plannedBanner.pullResult;
  if (!result) return null;

  if (section === 'pulls') {
    const inputId = `${idPrefix}-actual-pulls`;
    return (
      <div className={cn('grid gap-1', className)}>
        <label htmlFor={inputId} className="text-[11px] text-muted-foreground">
          Actual total pulls
        </label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={result.pulls}
          onChange={(event) => setPullResultPulls(row.event.id, normalizeInput(event.target.value))}
          className="font-mono text-right tabular-nums"
        />
        <div className="font-mono text-[11px] text-muted-foreground tabular-nums">
          Cost {formatCarats(row.cost)}
        </div>
      </div>
    );
  }

  if (section === 'tickets') {
    const inputId = `${idPrefix}-actual-tickets`;
    const descriptionId = `${inputId}-description`;
    return (
      <div className={cn('grid gap-1', className)}>
        <label htmlFor={inputId} className="text-[11px] text-muted-foreground">
          Actual ticket pulls
        </label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={result.ticketsUsed}
          onChange={(event) =>
            setPullResultTicketsUsed(row.event.id, normalizeInput(event.target.value))
          }
          aria-describedby={descriptionId}
          className="font-mono text-right tabular-nums"
        />
        <span id={descriptionId} className="text-[11px] text-muted-foreground">
          Included in total
        </span>
        {row.ticketDeficit > 0 ? (
          <p className="text-[11px] leading-snug text-destructive">
            Recorded use exceeds your configured starting tickets by{' '}
            {row.ticketDeficit.toLocaleString()}.
          </p>
        ) : null}
      </div>
    );
  }

  const targets = bannerPickupTargets(row.event);
  if (targets.length === 0) {
    return (
      <p className={cn('text-[11px] text-muted-foreground', className)}>
        No pickup targets are available for this banner.
      </p>
    );
  }

  return (
    <fieldset className={cn('rounded-lg border bg-muted/40 p-2', className)}>
      <legend className="px-1 text-[11px] font-medium">Pickup copies · sparks included</legend>
      <div className="grid grid-cols-2 gap-2">
        {targets.map((target) => {
          const inputId = `${idPrefix}-pickup-${target.id}`;
          return (
            <div key={target.id} className="grid gap-1">
              <label
                htmlFor={inputId}
                className="truncate text-[11px] text-muted-foreground"
                title={target.name}
              >
                {target.name}
              </label>
              <Input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={result.pickupCopies[target.id] ?? 0}
                onChange={(event) =>
                  setPullResultPickupCopies(
                    row.event.id,
                    target.id,
                    normalizeInput(event.target.value)
                  )
                }
                className="font-mono text-right tabular-nums"
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
