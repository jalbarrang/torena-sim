import { Virtualizer } from '@tanstack/react-virtual';
import { flexRender, type Row } from '@tanstack/react-table';
import { ArrowLeft, ChartBar } from 'lucide-react';
import { SkillComparisonRoundResult } from '@/modules/simulation/types';
import { cn } from '@/lib/utils';
import { getBassinGridClass } from '../styles';
import { BASSIN_DATA_EVENT_TOGGLE_ACTIVATION_DETAILS } from '../activation-details/activation-details-dialog';
import { Button } from '../../ui/button';
import React, { useMemo } from 'react';

/** `data-event` value on the skill actions control; must match delegated handler in BasinnChart. */
export const BASSIN_DATA_EVENT_OPEN_SKILL_ACTIONS = 'open-skill-actions';

type BassinVirtualItem = ReturnType<
  Virtualizer<HTMLDivElement, Element>['getVirtualItems']
>[number];

type ExpandCellProps = {
  skillId: string;
  hasRunData: boolean;
};

const ExpandCell = React.memo(({ skillId, hasRunData }: ExpandCellProps) => {
  if (!hasRunData) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-event={BASSIN_DATA_EVENT_TOGGLE_ACTIVATION_DETAILS}
      data-skill-id={skillId}
      className="cursor-pointer"
    >
      <ChartBar />
    </Button>
  );
});

type ActionsCellProps = {
  skillId: string;
};

const ActionsCell = React.memo(({ skillId }: ActionsCellProps) => {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="size-8 p-0"
      data-event={BASSIN_DATA_EVENT_OPEN_SKILL_ACTIONS}
      data-skill-id={skillId}
      title="Skill actions"
    >
      <ArrowLeft />
    </Button>
  );
});

type BassinVirtualTableRowCellsProps = {
  row: Row<SkillComparisonRoundResult>;
  hasRunData: boolean;
};

const BassinVirtualTableRowCells = React.memo(function BassinVirtualTableRowCells(
  props: BassinVirtualTableRowCellsProps
) {
  const { row, hasRunData } = props;
  const id = row.getValue('id') as string;

  return (
    <>
      {row.getVisibleCells().map((cell) => {
        const columnId = cell.column.id;
        const cellValue = cell.getValue();
        const extraProps: Record<string, unknown> = {};

        if (columnId === 'id') {
          extraProps['data-itemtype'] = 'skill';
          extraProps['data-itemid'] = cellValue;
        }

        if (columnId === 'actions') {
          return <ActionsCell key={cell.id} skillId={id} />;
        }

        if (columnId === 'expand') {
          return (
            <div key={cell.id} className="flex items-center gap-2">
              <ExpandCell skillId={id} hasRunData={hasRunData} />
            </div>
          );
        }

        return (
          <div key={cell.id} className="flex items-center gap-2" {...extraProps}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        );
      })}
    </>
  );
});

type BassinVirtualTableRowProps = {
  virtualRow: BassinVirtualItem;
  row: Row<SkillComparisonRoundResult>;
  measureElement: (el: Element | null) => void;
  isSelected: boolean;
  isExpanded: boolean;
  hasRunData: boolean;
  isSearchMatch: boolean;
  isCurrentMatch: boolean;
  isPending: boolean;
  isHidden: boolean;
  showLPerSP: boolean;
};

const BassinVirtualTableRow = React.memo(function BassinVirtualTableRow(
  props: BassinVirtualTableRowProps
) {
  const {
    virtualRow,
    row,
    measureElement,
    isSelected,
    hasRunData,
    isSearchMatch,
    isCurrentMatch,
    isPending,
    isHidden,
    showLPerSP
  } = props;

  const classNameObject = useMemo(() => {
    return cn(
      'w-full bg-background hover:bg-muted p-2 border-b last-of-type:border-b-0',
      'flex flex-col gap-2 transition-opacity duration-300',
      {
        hidden: isHidden,
        'bg-primary/5': isSelected && !isSearchMatch,
        'bg-yellow-100/50 dark:bg-yellow-900/20': isSearchMatch && !isCurrentMatch,
        'bg-yellow-200/70 dark:bg-yellow-800/40': isCurrentMatch,
        'opacity-40': isPending
      }
    );
  }, [isHidden, isSelected, isSearchMatch, isCurrentMatch, isPending]);

  const styleObject = useMemo(() => {
    return {
      position: 'absolute',
      transform: `translateY(${virtualRow.start}px)`
    } satisfies React.CSSProperties;
  }, [virtualRow.start]);

  return (
    <div
      data-index={virtualRow.index}
      ref={measureElement}
      className={classNameObject}
      style={styleObject}
    >
      <div className={getBassinGridClass(showLPerSP)}>
        <BassinVirtualTableRowCells row={row} hasRunData={hasRunData} />
      </div>
    </div>
  );
});

export type BassinTableBodyProps = {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  rows: Row<SkillComparisonRoundResult>[];
  selectedSkills: string[];
  expandedSkillId: string | null;
  search: {
    matches: number[];
    currentMatchIndex: number;
  };
  hiddenSkills: string[];
  isSimulationRunning: boolean;
  showLPerSP: boolean;
};

export const BassinTableBody = React.memo((props: BassinTableBodyProps) => {
  const {
    virtualizer,
    rows,
    selectedSkills,
    expandedSkillId,
    search,
    hiddenSkills,
    isSimulationRunning,
    showLPerSP
  } = props;

  return (
    <div
      className="relative"
      style={{
        height: `${virtualizer.getTotalSize()}px`
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        const id: string = row.getValue('id');
        const isSelected = selectedSkills.includes(id);
        const isExpanded = expandedSkillId === id;
        const rowData = row.original;
        const hasRunData = rowData?.runData != null;
        const isSearchMatch = search.matches.includes(virtualRow.index);
        const isCurrentMatch = search.matches[search.currentMatchIndex] === virtualRow.index;
        const isPending = isSimulationRunning && rowData.results.length === 0;

        return (
          <BassinVirtualTableRow
            key={row.id}
            virtualRow={virtualRow}
            row={row}
            measureElement={virtualizer.measureElement}
            isSelected={isSelected}
            isExpanded={isExpanded}
            hasRunData={hasRunData}
            isSearchMatch={isSearchMatch}
            isCurrentMatch={isCurrentMatch}
            isPending={isPending}
            isHidden={hiddenSkills.includes(id)}
            showLPerSP={showLPerSP}
          />
        );
      })}
    </div>
  );
});
