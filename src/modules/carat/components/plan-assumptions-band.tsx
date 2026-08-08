import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchTimeline } from '@/modules/carat/data/timeline-client';
import { IncomeSettingsSections } from '@/modules/carat/components/income-settings';
import {
  setPlanAssumptionsBandOpen,
  setPlanAssumptionsTab,
  usePlanAssumptionsBand,
  type PlanAssumptionsTab
} from '@/modules/carat/components/plan-assumptions-band-state';
import { StartingResourcesFields } from '@/modules/carat/components/starting-resources';
import { countActiveIncomeSources, startingCaratTotal } from '@/modules/carat/model/assumptions';
import { listRewardSources, type RewardSource } from '@/modules/carat/model/income';
import { getActivePlan, useCaratStore } from '@/store/carat.store';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

function RewardSourceRow(props: { source: RewardSource }) {
  const { source } = props;
  const { carats, umaTickets, supportTickets } = source.income;

  return (
    <li className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block truncate">{source.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {source.kind === 'calendar' ? 'Calendar' : 'Event'} ·{' '}
          {dateFormatter.format(new Date(source.time))}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {carats.toLocaleString()}
        {umaTickets > 0 || supportTickets > 0 ? (
          <span className="ml-2 text-xs text-muted-foreground">
            {umaTickets}/{supportTickets} tix
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function PlanAssumptionsBand() {
  const isOpen = usePlanAssumptionsBand((state) => state.isOpen);
  const tab = usePlanAssumptionsBand((state) => state.tab);
  const settings = useCaratStore((state) => getActivePlan(state).settings);
  const timelineQuery = useQuery({
    queryKey: ['caratTimeline'],
    queryFn: fetchTimeline,
    staleTime: 5 * 60 * 1000
  });

  const now = new Date();
  const rewardSources = timelineQuery.data
    ? listRewardSources(settings, timelineQuery.data, now)
    : [];
  const startingCarats = startingCaratTotal(settings);
  const incomeSourceCount = countActiveIncomeSources(settings);

  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <Collapsible open={isOpen} onOpenChange={setPlanAssumptionsBandOpen}>
        <CollapsibleTrigger
          data-tutorial="carat-assumptions"
          className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <span className="text-sm font-bold">Plan assumptions</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              <strong className="font-mono font-semibold tabular-nums text-foreground">
                {startingCarats.toLocaleString()}
              </strong>{' '}
              starting carats
            </span>
            <span aria-hidden>·</span>
            <span>{plural(incomeSourceCount, 'income source')}</span>
            <span aria-hidden>·</span>
            <span>{plural(rewardSources.length, 'reward source')}</span>
            <ChevronDown className="size-4 transition-transform data-[panel-open]:rotate-180" />
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t px-4 py-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setPlanAssumptionsTab(value as PlanAssumptionsTab)}
          >
            <TabsList>
              <TabsTrigger value="balance">Balance</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
              <TabsTrigger value="rewards">Rewards</TabsTrigger>
            </TabsList>

            <TabsContent value="balance">
              <div
                data-tutorial="carat-starting-resources"
                className="grid gap-3 rounded-lg border bg-card p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold">Starting Carats / Tickets</h3>
                  <span className="text-[11px] text-muted-foreground">
                    Plan starts {dateFormatter.format(now)}
                  </span>
                </div>
                <StartingResourcesFields className="sm:grid-cols-4" />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Past results settle first. Future income and banners project from what remains.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="income">
              <IncomeSettingsSections />
            </TabsContent>

            <TabsContent value="rewards">
              <div data-tutorial="carat-rewards" className="rounded-lg border bg-card">
                <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                  Event and calendar rewards counted automatically into the next 12 months of
                  projected income. These are not editable.
                </div>
                {timelineQuery.isPending ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Loading rewards…</p>
                ) : rewardSources.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No event or calendar rewards fall inside the projection window.
                  </p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto">
                    {rewardSources.map((source) => (
                      <RewardSourceRow key={source.id} source={source} />
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
