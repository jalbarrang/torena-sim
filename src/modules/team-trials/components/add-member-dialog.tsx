import { useMemo, useState } from 'react';
import { SearchIcon } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { getUmaImageUrl } from '@/modules/runners/utils';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { addTeamTrialsMember } from '@/store/team-trials.store';
import type { RosterCategory } from '../model/types';
import { buildRosterMember } from '../model/roster';
import { CATEGORY_LABELS } from './team-column';

type AddMemberDialogProps = {
  category: RosterCategory | null;
  onOpenChange: (open: boolean) => void;
  /** Owned outfits whose character is not already rostered. */
  candidates: Array<UmaSearchEntry>;
  owned: Record<string, OwnedTrainee>;
};

export function AddMemberDialog(props: AddMemberDialogProps) {
  const { category, onOpenChange, candidates, owned } = props;

  const [search, setSearch] = useState('');

  const ranked = useMemo(() => {
    if (!category) return [];

    const query = search.trim().toLowerCase();

    return candidates
      .filter(
        (uma) =>
          query.length === 0 ||
          uma.name.toLowerCase().includes(query) ||
          uma.outfit.toLowerCase().includes(query)
      )
      .map((uma) => ({ uma, member: buildRosterMember(uma, owned[uma.id], category) }))
      .sort(
        (a, b) =>
          b.member.fit - a.member.fit ||
          b.member.stars - a.member.stars ||
          b.member.potential - a.member.potential ||
          a.uma.name.localeCompare(b.uma.name)
      );
  }, [candidates, owned, category, search]);

  const handleOpenChange = (open: boolean) => {
    if (!open) setSearch('');
    onOpenChange(open);
  };

  const handlePick = (outfitId: string) => {
    if (!category) return;
    addTeamTrialsMember(category, outfitId);
    handleOpenChange(false);
  };

  return (
    <Dialog open={category !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to {category ? CATEGORY_LABELS[category] : ''}</DialogTitle>
          <DialogDescription>
            Fit combines surface, distance, and best running-style aptitude for this trial; 1.00
            means no aptitude loss.
          </DialogDescription>
        </DialogHeader>

        <InputGroup>
          <InputGroupAddon>
            <SearchIcon className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search trainee..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ranked.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {candidates.length === 0
                ? 'Every owned character is already rostered.'
                : 'No trainees match.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {ranked.map(({ uma, member }) => (
                <li key={uma.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(uma.id)}
                    className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      src={getUmaImageUrl(uma.id)}
                      alt=""
                      loading="lazy"
                      className="size-9 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold leading-tight">
                        {uma.name}
                      </span>
                      <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                        {uma.outfit}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      <span className="block">
                        Fit <span className="text-foreground">{member.fit.toFixed(2)}</span>
                      </span>
                      <span className="block">
                        {member.stars}★ · P{member.potential}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
