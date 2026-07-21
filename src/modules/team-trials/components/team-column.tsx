import { memo } from 'react';
import { PlusIcon } from 'lucide-react';

import type { UmaSearchEntry } from '@/modules/runners/utils';
import { removeTeamTrialsMember, setTeamTrialsAce } from '@/store/team-trials.store';
import type { RosterCategory, RosterMember } from '../model/types';
import { MemberCard } from './member-card';

export const CATEGORY_LABELS: Record<RosterCategory, string> = {
  sprint: 'Sprint',
  mile: 'Mile',
  medium: 'Medium',
  long: 'Long',
  dirt: 'Dirt'
};

export const CATEGORY_RANGES: Record<RosterCategory, string> = {
  sprint: 'Turf 1000–1400m',
  mile: 'Turf 1401–1800m',
  medium: 'Turf 1801–2400m',
  long: 'Turf 2401m+',
  dirt: 'Dirt 1200–1800m'
};

type TeamColumnProps = {
  category: RosterCategory;
  members: Array<RosterMember>;
  teamSize: number;
  umasById: Map<string, UmaSearchEntry>;
  onAddMember: (category: RosterCategory) => void;
};

export const TeamColumn = memo((props: TeamColumnProps) => {
  const { category, members, teamSize, umasById, onAddMember } = props;

  // Ace renders first so the column mirrors the in-game builder layout.
  const ordered = [...members].sort((a, b) => Number(b.isAce) - Number(a.isAce));
  const emptySlots = Math.max(0, teamSize - members.length);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-baseline justify-between border-b bg-muted/40 px-3 py-2">
        <span className="text-[13px] font-semibold">{CATEGORY_LABELS[category]}</span>
        <span className="text-[10px] text-muted-foreground">{CATEGORY_RANGES[category]}</span>
      </div>
      {ordered.map((member) => (
        <MemberCard
          key={member.outfitId}
          member={member}
          uma={umasById.get(member.outfitId)}
          onRemove={() => removeTeamTrialsMember(category, member.outfitId)}
          onSetAce={() => setTeamTrialsAce(category, member.outfitId)}
        />
      ))}
      {Array.from({ length: emptySlots }, (_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onAddMember(category)}
          aria-label={`Add trainee to ${CATEGORY_LABELS[category]}`}
          className="flex min-h-[68px] items-center justify-center gap-1 border-b text-xs text-muted-foreground transition-colors last:border-b-0 hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-3.5" />
          Add trainee
        </button>
      ))}
    </div>
  );
});
