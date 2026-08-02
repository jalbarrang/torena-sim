import type { ReactNode } from 'react';
import { useCallback, useMemo, useReducer, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import { hasAnyAptitudeFilter, passesAptitudeFilters } from '../helpers';
import { DESKTOP_ROW_HEIGHT, MOBILE_ROW_HEIGHT } from '../constants';
import type { IAptitudeFilters, IAptitudeSlotKey, IDecodedRunner } from '../types';
import { AptitudeFilterGrid } from './filter-grid';
import { RunnerRow } from './runner-row';

type PickerState = {
  selected: Set<number>;
  search: string;
  aptFilters: IAptitudeFilters;
};

type PickerAction =
  | { type: 'search:set'; value: string }
  | { type: 'filters:clear' }
  | { type: 'selection:toggle'; index: number }
  | { type: 'selection:select-many'; indices: number[] }
  | { type: 'selection:deselect-many'; indices: number[] }
  | { type: 'filters:aptitude:set'; key: IAptitudeSlotKey; value: number | null };

const EMPTY_DISABLED_INDICES: ReadonlySet<number> = new Set();

type ImportRunnerPickerProps = {
  runners: IDecodedRunner[];
  sourceContent: ReactNode;
  initialSelectedIndices?: number[];
  disabledIndices?: ReadonlySet<number>;
  onCancel: () => void;
  onImport: (runners: IDecodedRunner[]) => void;
};

function createPickerState(initialSelectedIndices: number[]): PickerState {
  return {
    selected: new Set(initialSelectedIndices),
    search: '',
    aptFilters: {}
  };
}

function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case 'search:set':
      return { ...state, search: action.value };
    case 'filters:clear':
      return { ...state, search: '', aptFilters: {} };
    case 'selection:toggle': {
      const selected = new Set(state.selected);
      if (selected.has(action.index)) selected.delete(action.index);
      else selected.add(action.index);
      return { ...state, selected };
    }
    case 'selection:select-many': {
      const selected = new Set(state.selected);
      for (const index of action.indices) selected.add(index);
      return { ...state, selected };
    }
    case 'selection:deselect-many': {
      const selected = new Set(state.selected);
      for (const index of action.indices) selected.delete(index);
      return { ...state, selected };
    }
    case 'filters:aptitude:set': {
      const aptFilters = { ...state.aptFilters };
      if (action.value == null) delete aptFilters[action.key];
      else aptFilters[action.key] = action.value;
      return { ...state, aptFilters };
    }
    default: {
      const exhaustiveAction: never = action;
      return exhaustiveAction;
    }
  }
}

export function ImportRunnerPicker(props: Readonly<ImportRunnerPickerProps>) {
  const {
    runners,
    sourceContent,
    initialSelectedIndices = runners.map((_, index) => index),
    disabledIndices = EMPTY_DISABLED_INDICES,
    onCancel,
    onImport
  } = props;

  const [state, dispatch] = useReducer(pickerReducer, initialSelectedIndices, createPickerState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const hasActiveAptFilter = hasAnyAptitudeFilter(state.aptFilters);

  const filtered = useMemo(() => {
    const query = state.search.toLowerCase().trim();
    return runners.reduce<Array<{ runner: IDecodedRunner; index: number }>>(
      (items, runner, index) => {
        if (query && !runner.searchText.includes(query)) return items;
        if (hasActiveAptFilter && !passesAptitudeFilters(runner.source, state.aptFilters)) {
          return items;
        }
        items.push({ runner, index });
        return items;
      },
      []
    );
  }, [runners, state.search, state.aptFilters, hasActiveAptFilter]);

  const selectableFiltered = useMemo(
    () => filtered.filter(({ index }) => !disabledIndices.has(index)),
    [disabledIndices, filtered]
  );
  const filteredSelectedCount = useMemo(
    () => selectableFiltered.filter(({ index }) => state.selected.has(index)).length,
    [selectableFiltered, state.selected]
  );
  const allFilteredSelected =
    selectableFiltered.length > 0 && filteredSelectedCount === selectableFiltered.length;
  const someFilteredSelected = filteredSelectedCount > 0 && !allFilteredSelected;
  const hasActiveFilters = !!state.search.trim() || hasActiveAptFilter;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT),
    overscan: 15,
    getItemKey: (index) => {
      const item = filtered[index];
      return `${item.runner.source.card_id}-${item.index}`;
    }
  });

  const selectAllFiltered = useCallback(() => {
    dispatch({
      type: 'selection:select-many',
      indices: selectableFiltered.map(({ index }) => index)
    });
  }, [selectableFiltered]);

  const deselectAllFiltered = useCallback(() => {
    dispatch({
      type: 'selection:deselect-many',
      indices: selectableFiltered.map(({ index }) => index)
    });
  }, [selectableFiltered]);

  const toggleOne = useCallback(
    (index: number) => {
      if (!disabledIndices.has(index)) dispatch({ type: 'selection:toggle', index });
    },
    [disabledIndices]
  );

  const selectedRunners = useMemo(
    () => runners.filter((_, index) => state.selected.has(index) && !disabledIndices.has(index)),
    [disabledIndices, runners, state.selected]
  );

  return (
    <>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex flex-col gap-3 md:w-80 md:shrink-0">
          {sourceContent}

          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search imported characters"
                placeholder="Search characters..."
                value={state.search}
                onChange={(event) => dispatch({ type: 'search:set', value: event.target.value })}
                className="pl-8"
              />
            </div>

            <div className="hidden md:block">
              <AptitudeFilterGrid
                filters={state.aptFilters}
                onChange={(key, value) => dispatch({ type: 'filters:aptitude:set', key, value })}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                aria-label="Select all visible runners"
                checked={allFilteredSelected}
                indeterminate={someFilteredSelected}
                disabled={selectableFiltered.length === 0}
                onCheckedChange={(checked) => {
                  if (checked) selectAllFiltered();
                  else deselectAllFiltered();
                }}
              />

              <button
                type="button"
                className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
                disabled={selectableFiltered.length === 0}
                onClick={() => {
                  if (allFilteredSelected) deselectAllFiltered();
                  else selectAllFiltered();
                }}
              >
                {hasActiveFilters
                  ? `Select all ${selectableFiltered.length} matching`
                  : `Select all ${runners.length - disabledIndices.size}`}
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => dispatch({ type: 'filters:clear' })}
                >
                  <X className="size-3" />
                  Clear filters
                </button>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              {selectedRunners.length}/{runners.length - disabledIndices.size} available selected
              {hasActiveFilters && ` · ${filtered.length} shown`}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div ref={scrollRef} className="max-h-96 overflow-y-auto md:h-128 md:max-h-none">
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const { runner, index } = filtered[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute left-0 w-full"
                    style={{
                      height: isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    <RunnerRow
                      runner={runner}
                      index={index}
                      isSelected={state.selected.has(index)}
                      disabled={disabledIndices.has(index)}
                      onToggle={toggleOne}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {filtered.length === 0 && hasActiveFilters && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No characters match the current filters
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onImport(selectedRunners)} disabled={selectedRunners.length === 0}>
          Import{selectedRunners.length > 0 ? ` (${selectedRunners.length})` : ''}
        </Button>
      </DialogFooter>
    </>
  );
}
