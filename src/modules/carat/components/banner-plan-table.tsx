import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/modules/carat/components/info-hint';
import { SortablePlanCard } from '@/modules/carat/components/sortable-plan-card';
import { SortablePlanRow } from '@/modules/carat/components/sortable-plan-row';
import {
  StartingResourcesCard,
  StartingResourcesRow
} from '@/modules/carat/components/starting-resources';
import { useWideViewport } from '@/modules/carat/components/use-wide-viewport';
import type { TimelineEvent, TimelinePayload } from '@/modules/carat/data/timeline-types';
import { computePlan } from '@/modules/carat/model/plan';
import { getActivePlan, reorderPlannedBanners, useCaratStore } from '@/store/carat.store';

type BannerPlanTableProps = {
  timeline: TimelinePayload;
  showFirstVisitNudge?: boolean;
};
type SortMode = 'date' | 'manual';

function dateTime(event: TimelineEvent) {
  return new Date(event.global_release_date ?? event.jp_release_date ?? 0).getTime();
}

export function BannerPlanTable(props: BannerPlanTableProps) {
  const { timeline, showFirstVisitNudge = false } = props;
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const isWide = useWideViewport();
  const settings = useCaratStore((state) => getActivePlan(state).settings);
  const plannedBanners = useCaratStore((state) => getActivePlan(state).plannedBanners);
  const paidPurchases = useCaratStore((state) => getActivePlan(state).paidPurchases);
  const showPaid = settings.trackPaidCarats;
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const chronologicalRows = useMemo(
    () => computePlan(settings, timeline, plannedBanners, paidPurchases),
    [paidPurchases, plannedBanners, settings, timeline]
  );
  const rows = useMemo(() => {
    if (sortMode === 'manual') {
      return [...chronologicalRows].sort(
        (a, b) =>
          a.plannedBanner.order - b.plannedBanner.order || dateTime(a.event) - dateTime(b.event)
      );
    }
    return chronologicalRows;
  }, [chronologicalRows, sortMode]);
  const oldestProvisionalBannerId = chronologicalRows.find((row) => row.status === 'provisional')
    ?.event.id;
  const provisionalCount = chronologicalRows.filter((row) => row.status === 'provisional').length;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = rows.map((row) => row.event.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const nextIds = [...ids];
    const [moved] = nextIds.splice(oldIndex, 1);
    nextIds.splice(newIndex, 0, moved);
    reorderPlannedBanners(nextIds);
    setSortMode('manual');
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant={sortMode === 'date' ? 'secondary' : 'outline'}
          type="button"
          onClick={() => setSortMode('date')}
        >
          Date sort
        </Button>
        <Button
          size="sm"
          variant={sortMode === 'manual' ? 'secondary' : 'outline'}
          type="button"
          onClick={() => setSortMode('manual')}
        >
          Manual order
        </Button>
      </div>

      {provisionalCount > 0 ? (
        <p
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {provisionalCount === 1
            ? '1 past banner needs attention. Its planned spend is provisional, so later totals may change.'
            : `${provisionalCount} past banners need attention. Their planned spend is provisional, so later totals may change.`}
        </p>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {isWide ? (
          <div className="w-full overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-2" />
                  <th scope="col" className="px-2 py-2 text-left">
                    Timeline
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Carats avail.
                  </th>
                  <th scope="col" className="w-44 min-w-44 px-2 py-2 text-left">
                    <span className="inline-flex items-center gap-1">
                      Pulls
                      <InfoHint label="Pulls and sparks help" title="Pulls and sparks">
                        One pull costs 150 carats. One spark is 200 pulls and can be exchanged for a
                        guaranteed pickup copy.
                      </InfoHint>
                    </span>
                  </th>
                  <th scope="col" className="w-44 min-w-44 px-2 py-2 text-left">
                    Tickets
                  </th>
                  <th scope="col" className="px-2 py-2 text-center">
                    <span className="inline-flex items-center gap-1">
                      Odds / result
                      <InfoHint label="Copy odds help" title="LB / MLB odds">
                        LB means limit break copies. MLB usually means five total copies. The bar
                        estimates the chance to end at each copy count. For Uma banners, it instead
                        shows the fixed chance to pull the rate-up Uma, and to pull any off-banner
                        3-star Uma, within 200 pulls.
                      </InfoHint>
                    </span>
                  </th>
                  <th scope="col" className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                <StartingResourcesRow />
                <SortableContext
                  items={rows.map((row) => row.event.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {rows.map((row) => (
                    <SortablePlanRow
                      key={row.event.id}
                      row={row}
                      showPaid={showPaid}
                      isPrimary={!showFirstVisitNudge && row.event.id === oldestProvisionalBannerId}
                    />
                  ))}
                </SortableContext>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center">
                      <div className="text-sm font-semibold">Start with three quick steps</div>
                      <ol className="mx-auto mt-3 w-fit space-y-1 text-left text-sm text-muted-foreground">
                        <li>1. Set your available carats and tickets above</li>
                        <li>
                          2. Add a banner with{' '}
                          <span className="font-medium text-foreground">
                            + Add banner from timeline
                          </span>
                        </li>
                        <li>3. Set pulls and review the projection</li>
                      </ol>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-3">
            <StartingResourcesCard />
            <SortableContext
              items={rows.map((row) => row.event.id)}
              strategy={verticalListSortingStrategy}
            >
              {rows.map((row) => (
                <SortablePlanCard
                  key={row.event.id}
                  row={row}
                  showPaid={showPaid}
                  isPrimary={!showFirstVisitNudge && row.event.id === oldestProvisionalBannerId}
                />
              ))}
            </SortableContext>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-background/60 p-8 text-center">
                <div className="text-sm font-semibold">Start with three quick steps</div>
                <ol className="mx-auto mt-3 w-fit space-y-1 text-left text-sm text-muted-foreground">
                  <li>1. Set your available carats and tickets above</li>
                  <li>
                    2. Add a banner with{' '}
                    <span className="font-medium text-foreground">+ Add banner from timeline</span>
                  </li>
                  <li>3. Set pulls and review the projection</li>
                </ol>
              </div>
            ) : null}
          </div>
        )}
      </DndContext>
    </div>
  );
}
