import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BannerIdentity } from '@/modules/carat/components/banner-identity';
import { BannerLifecycle } from '@/modules/carat/components/banner-lifecycle';
import { BannerLifecycleActions } from '@/modules/carat/components/banner-lifecycle-actions';
import { BannerOutcome } from '@/modules/carat/components/banner-outcome';
import { BannerPullResultFields } from '@/modules/carat/components/banner-pull-result-fields';
import { formatCarats } from '@/modules/carat/components/banner-plan-format';
import { InfoHint } from '@/modules/carat/components/info-hint';
import { PlanDragHandle } from '@/modules/carat/components/plan-drag-handle';
import { PullsField } from '@/modules/carat/components/pulls-field';
import { TicketsField } from '@/modules/carat/components/tickets-field';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import { cn } from '@/lib/utils';

type SortablePlanCardProps = {
  row: BannerPlanRow;
  showPaid: boolean;
  isPrimary?: boolean;
};

export function SortablePlanCard(props: SortablePlanCardProps) {
  const { row, showPaid, isPrimary } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.event.id
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const totalAvail = row.caratsAvailable;
  const isRecorded = row.status === 'recorded';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-xl border bg-card p-3',
        row.status === 'provisional' && 'border-destructive/30 bg-destructive/5',
        isDragging && 'relative z-10 shadow-md'
      )}
    >
      <div className="flex items-start gap-2">
        <PlanDragHandle attributes={attributes} listeners={listeners} className="mt-1" />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <BannerIdentity row={row} showWindow />
            <BannerLifecycle row={row} className="mt-2" />
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>Carats avail.</div>
            {showPaid ? (
              <div className="mt-0.5 grid gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px]">Total</span>
                  <span className="font-mono text-lg font-semibold text-foreground tabular-nums">
                    {formatCarats(totalAvail)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span>Paid</span>
                  <span className="font-mono tabular-nums">
                    {formatCarats(row.paidCaratsAvailable)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span>Free</span>
                  <span className="font-mono tabular-nums">
                    {formatCarats(row.freeCaratsAvailable)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="font-mono text-lg font-semibold text-foreground tabular-nums">
                {formatCarats(totalAvail)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <div className="grid gap-1">
          <span className="inline-flex items-center gap-1">
            Pulls
            <InfoHint label="Pulls and sparks help" title="Pulls and sparks">
              One pull costs 150 carats. One spark is 200 pulls and can be exchanged for a
              guaranteed pickup copy.
            </InfoHint>
          </span>
          {isRecorded ? (
            <BannerPullResultFields row={row} section="pulls" />
          ) : (
            <PullsField row={row} showCost />
          )}
        </div>
        <div className="grid gap-1">
          <span>Tickets</span>
          {isRecorded ? (
            <BannerPullResultFields row={row} section="tickets" />
          ) : (
            <TicketsField row={row} />
          )}
        </div>
      </div>

      <BannerOutcome row={row} className="mt-3" />

      <div className="mt-3 flex items-center justify-end gap-2">
        <BannerLifecycleActions row={row} isPrimary={isPrimary} />
      </div>
    </div>
  );
}
