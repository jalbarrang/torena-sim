import { useQuery } from '@tanstack/react-query';
import { HelpCircle } from 'lucide-react';
import {
  monthlyRecurringCarats,
  projectMonthlyIncomeBreakdown,
  type MonthlyIncomeBreakdown,
  type ProjectedIncome
} from '@/modules/carat/model/income';
import { fetchTimeline } from '@/modules/carat/data/timeline-client';
import { computePlan } from '@/modules/carat/model/plan';
import { getActivePlan, useCaratStore } from '@/store/carat.store';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

function formatCarats(value: number) {
  return Math.round(value).toLocaleString();
}

function formatTickets(value: number) {
  return (Math.round(value * 10) / 10).toLocaleString();
}

function Stat(props: {
  label: string;
  value: string;
  sub: string;
  labelAction?: React.ReactNode;
  badge?: React.ReactNode;
  valueClassName?: string;
}) {
  const { label, value, sub, labelAction, badge, valueClassName } = props;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <div className="text-xs font-bold text-muted-foreground">{label}</div>
        {labelAction}
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <div className={cn('text-lg font-semibold tabular-nums', valueClassName)}>{value}</div>
        {badge}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function BreakdownRow(props: { label: string; income: ProjectedIncome; emphasize?: boolean }) {
  const { label, income, emphasize } = props;

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 text-sm',
        emphasize ? 'font-semibold' : 'text-muted-foreground'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        {formatCarats(income.carats)}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {formatTickets(income.umaTickets)}/{formatTickets(income.supportTickets)} tix
        </span>
      </span>
    </div>
  );
}

function IncomeBreakdownHint(props: { breakdown: MonthlyIncomeBreakdown }) {
  const { breakdown } = props;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Show monthly income breakdown"
          />
        }
      >
        <HelpCircle className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 gap-2 p-3">
        <PopoverTitle>Monthly income breakdown</PopoverTitle>
        <PopoverDescription>
          Average of the next 365 days of projected income, shown per 30 days. Tickets are Uma /
          Support scout tickets.
        </PopoverDescription>
        <div className="flex flex-col gap-1.5">
          <BreakdownRow label="Recurring rewards" income={breakdown.recurring} />
          <BreakdownRow label="Champions Meeting" income={breakdown.championsMeeting} />
          <BreakdownRow label="League of Heroes" income={breakdown.leagueOfHeroes} />
          <BreakdownRow label="Events & calendar" income={breakdown.eventsAndCalendar} />
          <div className="border-t pt-1.5">
            <BreakdownRow label="Total" income={breakdown.total} emphasize />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SummaryStats() {
  const settings = useCaratStore((state) => getActivePlan(state).settings);
  const plannedBanners = useCaratStore((state) => getActivePlan(state).plannedBanners);
  const paidPurchases = useCaratStore((state) => getActivePlan(state).paidPurchases);
  const timelineQuery = useQuery({
    queryKey: ['caratTimeline'],
    queryFn: fetchTimeline,
    staleTime: 5 * 60 * 1000
  });
  const now = new Date();
  const monthly = monthlyRecurringCarats(settings, now);
  const breakdown = timelineQuery.data
    ? projectMonthlyIncomeBreakdown(settings, timelineQuery.data, now)
    : null;
  const plan = timelineQuery.data
    ? computePlan(settings, timelineQuery.data, plannedBanners, paidPurchases, { now })
    : [];
  const totalSpend = plan.reduce((total, row) => total + row.cost, 0);
  const totalPulls = plan.reduce((total, row) => total + row.effectivePulls, 0);
  const provisionalCount = plan.filter((row) => row.status === 'provisional').length;
  const lastRow = plan.at(-1);

  const affordable = lastRow?.affordable === true;
  const short = lastRow?.affordable === false;
  const shortfall = lastRow ? Math.abs(lastRow.balanceAfter) : 0;

  return (
    <section
      data-tutorial="carat-summary"
      className={cn(
        'flex flex-wrap gap-x-8 gap-y-4 rounded-xl border px-4 py-3 shadow-sm',
        affordable && 'border-emerald-600/30 bg-emerald-500/6 dark:border-emerald-400/25',
        short && 'border-destructive/30 bg-destructive/6',
        !lastRow && 'bg-card'
      )}
    >
      {/* Primary verdict — the one answer this page exists to deliver. */}
      <Stat
        label="Balance at last banner"
        value={lastRow ? formatCarats(lastRow.balanceAfter) : '—'}
        valueClassName={cn(
          'text-xl font-bold',
          affordable && 'text-emerald-600 dark:text-emerald-400',
          short && 'text-destructive'
        )}
        badge={
          lastRow ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-semibold',
                affordable && 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300',
                short && 'bg-destructive/15 text-destructive'
              )}
            >
              {affordable ? 'Affordable ✓' : 'Short'}
            </span>
          ) : null
        }
        sub={
          lastRow
            ? affordable
              ? 'left over after your final planned spend'
              : `short by ${formatCarats(shortfall)} — about ${Math.ceil(shortfall / 150).toLocaleString()} more pulls of income`
            : 'add a banner from the timeline to project your balance'
        }
      />

      {/* Supporting context — same strip, visually subordinate to the verdict. */}
      <Stat
        label="Current Carats"
        value={settings.startingFreeCarats.toLocaleString()}
        sub={settings.trackPaidCarats ? '+ paid pool tracked' : '+ paid not tracked'}
      />
      <Stat
        label="Starting Tickets"
        value={`${settings.umaTickets.toLocaleString()} / ${settings.supportTickets.toLocaleString()}`}
        sub="Uma / Support · typed pools"
      />
      <Stat
        label="Monthly Income"
        value={formatCarats(breakdown ? breakdown.total.carats : monthly.carats)}
        sub={
          breakdown
            ? `all-in · ${formatTickets(breakdown.total.umaTickets)}/${formatTickets(breakdown.total.supportTickets)} tickets/mo`
            : `recurring only · ${monthly.umaTickets}/${monthly.supportTickets} tickets/mo`
        }
        labelAction={breakdown ? <IncomeBreakdownHint breakdown={breakdown} /> : null}
      />
      <Stat
        label="Total Spend"
        value={totalSpend > 0 ? formatCarats(totalSpend) : '0'}
        sub={`${totalPulls.toLocaleString()} pulls · ${plan.length.toLocaleString()} banner${plan.length === 1 ? '' : 's'}${provisionalCount > 0 ? ` · ${provisionalCount} provisional` : ''}`}
      />
    </section>
  );
}
