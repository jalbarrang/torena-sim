import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  APTITUDE_SLOTS,
  bannerAptitudes,
  type BannerAptitudeKey
} from '@/modules/carat/data/banner-aptitudes';
import { bannerImageUrl } from '@/modules/carat/data/banner-image';
import { bannerLifecycle } from '@/modules/carat/data/banner-lifecycle';
import { resolveBannerLabel } from '@/modules/carat/data/card-names';
import type {
  TimelineEvent,
  TimelinePayload,
  TimelinePredictionKind
} from '@/modules/carat/data/timeline-types';
import {
  addPlannedBanner,
  getActivePlan,
  removePlannedBanner,
  useCaratStore
} from '@/store/carat.store';
import { cn } from '@/lib/utils';

type BannerTypeFilter = 'all' | 'character' | 'support';

type AddBannerDialogProps = {
  timeline: TimelinePayload;
  showFirstVisitNudge?: boolean;
};

type FilterOption<T extends string> = { value: T; label: string };

const TYPE_OPTIONS: FilterOption<BannerTypeFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'character', label: 'Characters' },
  { value: 'support', label: 'Support' }
];

/**
 * Confidence is encoded with the warm token ramp by descending emphasis, not raw
 * palette hues: a filled chip reads as locked-in, an outline as estimated, faint
 * muted as a loose prediction. Tokenized + on-brand (no off-system emerald/amber).
 */
function ConfidenceBadge(props: { kind: TimelinePredictionKind | undefined }) {
  const { kind } = props;
  if (kind === 'confirmed') return <Badge variant="secondary">Confirmed</Badge>;
  if (kind === 'interpolated') return <Badge variant="outline">Estimated</Badge>;
  return (
    <Badge variant="ghost" className="text-muted-foreground">
      Predicted
    </Badge>
  );
}

function typeLabel(cardType: string | null) {
  if (!cardType) return 'Banner';
  return cardType.charAt(0).toUpperCase() + cardType.slice(1);
}

function dateText(value: string | null | undefined) {
  if (!value) return 'Date TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value));
}

function windowSuffix(event: TimelineEvent) {
  const duration = event.banner_duration_days;
  return duration ? ` · ${duration}d` : '';
}

function searchableText(event: TimelineEvent) {
  return [
    resolveBannerLabel(event),
    event.related_characters?.join(' '),
    event.related_support_cards?.join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function FilterGroup<T extends string>(props: {
  label: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-xs font-medium whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <div role="group" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Multi-toggle chips for the innate grade-A ("main") aptitudes of a banner's
// pickup umas. Any active chip implies character banners only.
function AptitudeFilterGroup(props: {
  value: ReadonlySet<BannerAptitudeKey>;
  onToggle: (key: BannerAptitudeKey) => void;
}) {
  const { value, onToggle } = props;
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-xs font-medium whitespace-nowrap text-muted-foreground">
        Aptitude
      </span>
      <div
        role="group"
        aria-label="Main aptitude"
        className="flex gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {APTITUDE_SLOTS.map((slot) => {
          const active = value.has(slot.key);
          return (
            <button
              key={slot.key}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(slot.key)}
              className={cn(
                'inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {slot.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AddBannerDialog(props: AddBannerDialogProps) {
  const { timeline, showFirstVisitNudge = false } = props;
  const [open, setOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<BannerTypeFilter>('all');
  const [aptitudeFilter, setAptitudeFilter] = useState<ReadonlySet<BannerAptitudeKey>>(new Set());
  const [search, setSearch] = useState('');
  const plannedBanners = useCaratStore(useShallow((state) => getActivePlan(state).plannedBanners));
  const plannedIds = useMemo(
    () => new Set(plannedBanners.map((banner) => banner.id)),
    [plannedBanners]
  );
  const hasPastUnresolvedBanner = useMemo(() => {
    const eventsById = new Map(timeline.events.map((event) => [event.id, event]));
    const now = new Date();
    return plannedBanners.some((banner) => {
      const event = eventsById.get(banner.id);
      return !banner.pullResult && event && bannerLifecycle(event, now) === 'past';
    });
  }, [plannedBanners, timeline.events]);

  const filtersActive = typeFilter !== 'all' || aptitudeFilter.size > 0 || search.trim() !== '';
  const clearFilters = () => {
    setTypeFilter('all');
    setAptitudeFilter(new Set());
    setSearch('');
  };

  const toggleAptitude = (key: BannerAptitudeKey) => {
    setAptitudeFilter((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const banners = useMemo(() => {
    const now = new Date();
    const searchText = search.trim().toLowerCase();

    return timeline.events
      .filter((event) => event.type === 'character_banner' || event.type === 'support_card_banner')
      .filter((event) => bannerLifecycle(event, now) !== 'past')
      .filter((event) => typeFilter === 'all' || event.card_type === typeFilter)
      .filter((event) => {
        if (aptitudeFilter.size === 0) return true;
        const aptitudes = bannerAptitudes(event);
        if (!aptitudes) return false;
        const main = new Set(aptitudes.main.map((slot) => slot.key));
        return [...aptitudeFilter].every((key) => main.has(key));
      })
      .filter((event) => !searchText || searchableText(event).includes(searchText))
      .sort(
        (a, b) =>
          new Date(a.global_release_date ?? 0).getTime() -
          new Date(b.global_release_date ?? 0).getTime()
      );
  }, [aptitudeFilter, search, timeline.events, typeFilter]);

  // Toggle in place and keep the dialog open so a whole plan can be built in one pass.
  const handleToggle = (id: string) => {
    if (plannedIds.has(id)) {
      removePlannedBanner(id);
    } else {
      addPlannedBanner(id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            data-tutorial="carat-add-banner"
            type="button"
            variant={showFirstVisitNudge || hasPastUnresolvedBanner ? 'secondary' : 'default'}
          />
        }
      >
        + Add banner from timeline
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-5xl!"
        showCloseButton
      >
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Add banners from timeline</DialogTitle>
          <DialogDescription>
            Tap to add or remove available banners. The list stays open so you can build your whole
            plan in one go.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-start gap-2 px-4">
          <FilterGroup
            label="Type"
            value={typeFilter}
            options={TYPE_OPTIONS}
            onChange={setTypeFilter}
          />
          <AptitudeFilterGroup value={aptitudeFilter} onToggle={toggleAptitude} />
        </div>

        <div className="flex items-center justify-between gap-2 px-4 pt-2 text-xs text-muted-foreground">
          <span>
            {banners.length.toLocaleString()} available banner{banners.length === 1 ? '' : 's'}
          </span>
          {filtersActive ? (
            <Button size="xs" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search banners, characters, or cards…"
          />
          <CommandList className="max-h-[56vh]">
            <CommandEmpty>
              <div className="flex flex-col items-center gap-3 py-2">
                <span>No available banners match these filters.</span>
                {filtersActive ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </CommandEmpty>
            {banners.map((event) => {
              const added = plannedIds.has(event.id);
              const kind = event.prediction?.kind;
              const aptitudes = bannerAptitudes(event);
              return (
                <CommandItem
                  key={event.id}
                  value={event.id}
                  onSelect={() => handleToggle(event.id)}
                  className={cn('items-start gap-3 py-2', added && 'bg-secondary/40')}
                  aria-label={`${resolveBannerLabel(event)}, ${added ? 'added — tap to remove' : 'tap to add'}`}
                >
                  <img
                    src={bannerImageUrl(event)}
                    alt=""
                    className="aspect-[9/6] w-24 shrink-0 rounded-lg object-contain"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{resolveBannerLabel(event)}</div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {dateText(event.global_release_date)}
                      {windowSuffix(event)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="outline">{typeLabel(event.card_type)}</Badge>
                      <ConfidenceBadge kind={kind} />
                      {aptitudes?.main.map((slot) => (
                        <Badge key={slot.key} variant="secondary">
                          {slot.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {added ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 self-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                      <Check className="size-3" aria-hidden="true" />
                      Added
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {plannedIds.size.toLocaleString()} banner{plannedIds.size === 1 ? '' : 's'} in your plan
          </span>
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
