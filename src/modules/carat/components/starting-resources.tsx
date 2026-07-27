import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { getActivePlan, setCaratSetting, useCaratStore } from '@/store/carat.store';
import { cn } from '@/lib/utils';

type StartingResource = 'free' | 'paid' | 'umaTickets' | 'supportTickets';

type StartingResourcesFieldsProps = {
  resources?: StartingResource[];
  className?: string;
};

const resourceDefinitions: Record<
  StartingResource,
  {
    label: string;
    setting: 'startingFreeCarats' | 'startingPaidCarats' | 'umaTickets' | 'supportTickets';
  }
> = {
  free: { label: 'Free carats', setting: 'startingFreeCarats' },
  paid: { label: 'Paid carats', setting: 'startingPaidCarats' },
  umaTickets: { label: 'Uma tickets', setting: 'umaTickets' },
  supportTickets: { label: 'Support tickets', setting: 'supportTickets' }
};

function StartingResourcesFields(props: StartingResourcesFieldsProps) {
  const { resources = ['free', 'paid', 'umaTickets', 'supportTickets'], className } = props;
  const settings = useCaratStore((state) => getActivePlan(state).settings);
  const idPrefix = useId();

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {resources.map((resource) => {
        const definition = resourceDefinitions[resource];
        const id = `${idPrefix}-${resource}`;
        return (
          <div key={resource} className="grid gap-1">
            <label htmlFor={id} className="text-[11px] text-muted-foreground">
              {definition.label}
            </label>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={settings[definition.setting]}
              onChange={(event) =>
                setCaratSetting(
                  definition.setting,
                  Math.max(0, Math.floor(Number(event.target.value) || 0))
                )
              }
              className="font-mono text-right tabular-nums"
            />
          </div>
        );
      })}
    </div>
  );
}

export function StartingResourcesRow() {
  return (
    <tr data-tutorial="carat-starting-resources" className="bg-primary/5 align-top">
      <td className="w-10 px-2 py-3">
        <span
          aria-label="Timeline origin"
          className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          1
        </span>
      </td>
      <th scope="row" className="min-w-[220px] px-2 py-3 text-left">
        <div className="text-sm font-semibold">Starting Carats / Tickets</div>
        <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
          Your pull plan begins here.
        </p>
      </th>
      <td className="min-w-56 px-2 py-3">
        <StartingResourcesFields resources={['free', 'paid']} />
      </td>
      <td className="w-44 min-w-44 px-2 py-3 text-[11px] text-muted-foreground">
        Banner pulls subtract from this starting pool.
      </td>
      <td className="min-w-56 px-2 py-3">
        <StartingResourcesFields resources={['umaTickets', 'supportTickets']} />
      </td>
      <td className="min-w-64 px-2 py-3 text-[11px] text-muted-foreground">
        Past results settle first. Future income and banners project from what remains.
      </td>
      <td className="w-32 px-2 py-3" />
    </tr>
  );
}

export function StartingResourcesCard() {
  return (
    <article
      data-tutorial="carat-starting-resources"
      className="rounded-xl border border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-start gap-2">
        <span
          aria-label="Timeline origin"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          1
        </span>
        <div>
          <h3 className="text-sm font-semibold">Starting Carats / Tickets</h3>
          <p className="text-[11px] text-muted-foreground">Your pull plan begins here.</p>
        </div>
      </div>
      <StartingResourcesFields className="mt-3" />
      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        Past results settle first. Future income and banners project from what remains.
      </p>
    </article>
  );
}
