import { createContext, useContext } from 'react';

import { flexRender } from '@tanstack/react-table';
import type { Column, HeaderGroup, SortingState, Table } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, CircleHelp } from 'lucide-react';
import { Button } from '../../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { cn } from '@/lib/utils';
import { getBassinGridClass } from '../styles';
import type { SkillComparisonRoundResult } from '@/modules/simulation/types';

const BassinTableSortingContext = createContext<SortingState>([]);

function getColumnSortDirection(columnId: string, sorting: SortingState): false | 'asc' | 'desc' {
  const entry = sorting.find((s) => s.id === columnId);
  if (!entry) return false;
  return entry.desc ? 'desc' : 'asc';
}

const SORTABLE_HEADER_IDS = new Set(['min', 'max', 'mean', 'median', 'lPerSP']);

type ColumnSortIconProps = {
  isSorted: false | 'asc' | 'desc';
};

function ColumnSortIcon(props: ColumnSortIconProps) {
  const { isSorted } = props;

  if (isSorted === 'asc') return <ArrowUp />;
  if (isSorted === 'desc') return <ArrowDown />;
  return <ArrowUpDown />;
}

type SortableHeaderProps = {
  name: string;
  column: Column<SkillComparisonRoundResult>;
  tooltip?: string;
};

function SortableHeader(props: SortableHeaderProps) {
  const { name, column, tooltip } = props;

  const sorting = useContext(BassinTableSortingContext);
  const isSorted = getColumnSortDirection(column.id, sorting);
  const toggleColumnSort = column.getToggleSortingHandler();

  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" onClick={toggleColumnSort} className="cursor-pointer p-0">
        {name}
        <ColumnSortIcon isSorted={isSorted} />
      </Button>

      {tooltip && (
        <Tooltip>
          <TooltipTrigger render={<CircleHelp className="size-3 text-muted-foreground" />} />
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export const sortableHeader = (name: string, tooltip?: string) => {
  return ({ column }: { column: Column<SkillComparisonRoundResult> }) => (
    <SortableHeader name={name} column={column} tooltip={tooltip} />
  );
};

type BassinTableHeaderRowProps = {
  headerGroup: HeaderGroup<SkillComparisonRoundResult>;
  showLPerSP: boolean;
};

const BassinTableHeaderRow = (props: BassinTableHeaderRowProps) => {
  const { headerGroup, showLPerSP } = props;

  return (
    <div className={cn('bg-card hover:bg-muted p-2', getBassinGridClass(showLPerSP))}>
      {headerGroup.headers.map((header) => (
        <div
          key={header.id}
          className={cn('flex items-center gap-2', {
            'cursor-pointer': SORTABLE_HEADER_IDS.has(header.id)
          })}
        >
          {header.isPlaceholder
            ? null
            : flexRender(header.column.columnDef.header, header.getContext())}
        </div>
      ))}
    </div>
  );
};

type BassinTableHeaderProps = {
  table: Table<SkillComparisonRoundResult>;
  sorting: SortingState;
  showLPerSP: boolean;
};

export function BassinTableHeader(props: BassinTableHeaderProps) {
  const { table, sorting, showLPerSP } = props;

  return (
    <BassinTableSortingContext.Provider value={sorting}>
      {table.getHeaderGroups().map((headerGroup) => (
        <BassinTableHeaderRow
          key={headerGroup.id}
          headerGroup={headerGroup}
          showLPerSP={showLPerSP}
        />
      ))}
    </BassinTableSortingContext.Provider>
  );
}
