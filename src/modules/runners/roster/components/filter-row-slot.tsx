import { useCallback } from 'react';
import { IAptitudeFilters, IAptitudeSlotKey } from '../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { MIN_GRADES } from '../constants';
import { encodingToAptitude } from '../../share/converters';

type IAptitudeFilterRowSlotProps = {
  slot: { key: IAptitudeSlotKey; name: string };
  filters: IAptitudeFilters;
  onChange: (key: IAptitudeSlotKey, value: number | null) => void;
};

export const AptitudeFilterRowSlot = (props: Readonly<IAptitudeFilterRowSlotProps>) => {
  const { slot, filters, onChange } = props;

  const current = filters[slot.key];
  const value = current !== undefined && current !== null ? String(current) : 'any';
  const label = current !== undefined && current !== null ? encodingToAptitude(current) : 'All';

  const onValueChange = useCallback(
    (v: string | null) => {
      if (v === 'any') {
        onChange(slot.key, null);
        return;
      }

      onChange(slot.key, Number(v));
    },
    [onChange, slot.key]
  );

  return (
    <div key={slot.key} className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-[42px]">{slot.name}</span>

      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger size="sm" className="w-auto min-w-18 gap-1 text-xs">
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>

        <SelectContent className="text-xs">
          <SelectItem value="any">All</SelectItem>

          {MIN_GRADES.map((g) => (
            <SelectItem key={g} value={String(g)}>
              {encodingToAptitude(g)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
