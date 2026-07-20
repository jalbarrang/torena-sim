import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { DownloadIcon, SearchIcon, UploadIcon } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { UmaQuery } from '@/modules/runners/query';
import { useUmasForSearch } from '@/modules/runners/utils';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import { useTraineeListStore } from '@/store/trainee-list.store';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { downloadTraineeListSnapshot } from '../share/snapshot';
import { ImportTraineeListDialog } from './import-trainee-list-dialog';
import { TraineeTile } from './trainee-tile';

const ROW_HEIGHT = 178;
const VIRTUAL_OVERSCAN = 3;
const TILE_MIN_WIDTH = 150;

type OwnershipFilter = 'all' | 'owned' | 'unowned';
type SortKey = 'name' | 'rarity' | 'stars' | 'potential' | 'added';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'rarity', label: 'Base rarity' },
  { value: 'stars', label: 'Stars' },
  { value: 'potential', label: 'Potential' },
  { value: 'added', label: 'Recently added' }
];

function byName(a: UmaSearchEntry, b: UmaSearchEntry): number {
  return a.name.localeCompare(b.name) || a.outfit.localeCompare(b.outfit);
}

function sortUmas(
  umas: Array<UmaSearchEntry>,
  sortKey: SortKey,
  owned: Record<string, OwnedTrainee>
): Array<UmaSearchEntry> {
  const sorted = [...umas];

  switch (sortKey) {
    case 'name':
      sorted.sort(byName);
      break;
    case 'rarity':
      sorted.sort((a, b) => b.rarity - a.rarity || byName(a, b));
      break;
    case 'stars':
      sorted.sort((a, b) => {
        const starsA = owned[a.id]?.stars ?? 0;
        const starsB = owned[b.id]?.stars ?? 0;
        return starsB - starsA || byName(a, b);
      });
      break;
    case 'potential':
      sorted.sort((a, b) => {
        const potentialA = owned[a.id]?.potential ?? 0;
        const potentialB = owned[b.id]?.potential ?? 0;
        return potentialB - potentialA || byName(a, b);
      });
      break;
    case 'added':
      sorted.sort((a, b) => {
        const addedA = owned[a.id]?.addedAt ?? 0;
        const addedB = owned[b.id]?.addedAt ?? 0;
        return addedB - addedA || byName(a, b);
      });
      break;
  }

  return sorted;
}

export function TraineeListContent() {
  const [search, setSearch] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<'any' | '1' | '2' | '3'>('any');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [importOpen, setImportOpen] = useState(false);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(4);

  const deferredSearch = useDeferredValue(search);
  const owned = useTraineeListStore((state) => state.owned);
  const umas = useUmasForSearch(false);

  const ownedCount = Object.keys(owned).length;

  const filteredUmas = useMemo(() => {
    const query = UmaQuery.from(umas).whereText(deferredSearch);

    if (ownershipFilter === 'owned') {
      query.where((uma) => owned[uma.id] !== undefined);
    } else if (ownershipFilter === 'unowned') {
      query.where((uma) => owned[uma.id] === undefined);
    }

    if (rarityFilter !== 'any') {
      const rarity = Number(rarityFilter);
      query.where((uma) => uma.rarity === rarity);
    }

    return sortUmas(query.execute(), sortKey, owned);
  }, [umas, deferredSearch, ownershipFilter, rarityFilter, sortKey, owned]);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    const updateColumns = () => {
      const width = scrollElement.clientWidth;
      setColumns(Math.min(8, Math.max(2, Math.floor(width / TILE_MIN_WIDTH))));
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  const rowCount = Math.ceil(filteredUmas.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    enabled: scrollElement !== null,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT,
    overscan: VIRTUAL_OVERSCAN
  });

  const resetScroll = () => {
    scrollElement?.scrollTo({ top: 0 });
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    resetScroll();
  };

  const hasActiveFilters = search.length > 0 || ownershipFilter !== 'all' || rarityFilter !== 'any';

  const clearFilters = () => {
    setSearch('');
    setOwnershipFilter('all');
    setRarityFilter('any');
    resetScroll();
  };

  return (
    <div className="flex w-full min-h-0 flex-col gap-3 px-4 py-4">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Trainee List</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Track which trainees you own, with star unlock and potential —{' '}
            <span className="font-mono text-foreground">{ownedCount}</span>
            <span className="font-mono"> / {umas.length}</span> owned
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadTraineeListSnapshot()}
            disabled={ownedCount === 0}
          >
            <DownloadIcon />
            Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon />
            Import
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:max-w-64">
          <InputGroupAddon>
            <SearchIcon className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search trainee..."
            value={search}
            onChange={handleSearchChange}
          />
        </InputGroup>

        <ToggleGroup
          value={[ownershipFilter]}
          onValueChange={(value) => {
            if (value[0]) {
              setOwnershipFilter(value[0] as OwnershipFilter);
              resetScroll();
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="owned">Owned</ToggleGroupItem>
          <ToggleGroupItem value="unowned">Not owned</ToggleGroupItem>
        </ToggleGroup>

        <Select
          value={rarityFilter}
          onValueChange={(value) => {
            setRarityFilter(value as typeof rarityFilter);
            resetScroll();
          }}
        >
          <SelectTrigger size="sm" className="w-auto min-w-28 gap-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="any">Any rarity</SelectItem>
            <SelectItem value="1">1★ base</SelectItem>
            <SelectItem value="2">2★ base</SelectItem>
            <SelectItem value="3">3★ base</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={sortKey}
          onValueChange={(value) => {
            setSortKey(value as SortKey);
            resetScroll();
          }}
        >
          <SelectTrigger size="sm" className="w-auto min-w-36 gap-1 text-xs">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {filteredUmas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>No trainees match.</span>
          {hasActiveFilters && (
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div ref={setScrollElement} className="flex-1 min-h-0 overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize() }} className="relative w-full">
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const rowStart = virtualRow.index * columns;
              const rowUmas = filteredUmas.slice(rowStart, rowStart + columns);

              if (rowUmas.length === 0) {
                return null;
              }

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute top-0 left-0 w-full px-1 pb-2"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
                  >
                    {rowUmas.map((uma) => (
                      <TraineeTile key={uma.id} uma={uma} owned={owned[uma.id] ?? null} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ImportTraineeListDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
