import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BannerIdentity } from '@/modules/carat/components/banner-identity';
import { BannerLifecycle } from '@/modules/carat/components/banner-lifecycle';
import { BannerLifecycleActions } from '@/modules/carat/components/banner-lifecycle-actions';
import { BannerOutcome } from '@/modules/carat/components/banner-outcome';
import { BannerPullResultFields } from '@/modules/carat/components/banner-pull-result-fields';
import { formatCarats } from '@/modules/carat/components/banner-plan-format';
import { PlanDragHandle } from '@/modules/carat/components/plan-drag-handle';
import { PullsField } from '@/modules/carat/components/pulls-field';
import { TicketsField } from '@/modules/carat/components/tickets-field';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import { cn } from '@/lib/utils';

type SortablePlanRowProps = {
  row: BannerPlanRow;
  showPaid: boolean;
  isPrimary?: boolean;
};

export function SortablePlanRow(props: SortablePlanRowProps) {
  const { row, showPaid, isPrimary } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.event.id
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const totalAvail = row.caratsAvailable;
  const isRecorded = row.status === 'recorded';

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        'border-b align-top',
        row.status === 'provisional' && 'bg-destructive/5',
        isDragging && 'relative z-10 bg-accent shadow-md'
      )}
    >
      <td className="w-10 px-2 py-3">
        <PlanDragHandle attributes={attributes} listeners={listeners} />
      </td>
      <th scope="row" className="min-w-[220px] px-2 py-3 text-left font-normal">
        <BannerIdentity row={row} showWindow />
        <BannerLifecycle row={row} className="mt-2" />
      </th>
      <td className="px-2 py-3 text-right tabular-nums">
        {showPaid ? (
          <div className="ml-auto grid w-fit gap-0.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="font-mono text-base font-semibold text-foreground">
                {formatCarats(totalAvail)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
              <span>Paid</span>
              <span className="font-mono">{formatCarats(row.paidCaratsAvailable)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
              <span>Free</span>
              <span className="font-mono">{formatCarats(row.freeCaratsAvailable)}</span>
            </div>
          </div>
        ) : (
          <div className="font-mono text-base font-semibold text-foreground">
            {formatCarats(totalAvail)}
          </div>
        )}
      </td>
      <td className="w-44 min-w-44 px-2 py-3">
        {isRecorded ? (
          <BannerPullResultFields row={row} section="pulls" />
        ) : (
          <PullsField row={row} showCost density="table" />
        )}
      </td>
      <td className="w-44 min-w-44 px-2 py-3">
        {isRecorded ? (
          <BannerPullResultFields row={row} section="tickets" />
        ) : (
          <TicketsField row={row} density="table" />
        )}
      </td>
      <td className="px-2 py-3 text-left">
        <BannerOutcome row={row} />
      </td>
      <td className="w-32 px-2 py-3 text-right">
        <div className="flex flex-col items-end gap-1">
          <BannerLifecycleActions row={row} isPrimary={isPrimary} />
        </div>
      </td>
    </tr>
  );
}
