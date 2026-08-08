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

export function StartingResourcesFields(props: StartingResourcesFieldsProps) {
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
