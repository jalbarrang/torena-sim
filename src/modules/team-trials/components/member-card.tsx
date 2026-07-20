import { memo } from 'react';
import { CrownIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getUmaImageUrl } from '@/modules/runners/utils';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import type { UmaAptitudes } from '@/modules/data/services/UmaService';
import type { RosterMember } from '../model/types';

const STYLE_LABELS: Record<string, string> = {
  frontRunner: 'Front Runner',
  paceChaser: 'Pace Chaser',
  lateSurger: 'Late Surger',
  endCloser: 'End Closer'
};

const MAX_LEVEL = 5;

type PipsProps = {
  label: string;
  value: number;
  glyph: string;
  onClassName: string;
};

function Pips(props: PipsProps) {
  const { label, value, glyph, onClassName } = props;

  return (
    <span aria-label={`${label}: ${value} of ${MAX_LEVEL}`} className="tracking-[0.1em]">
      <span className={onClassName}>{glyph.repeat(value)}</span>
      <span className="text-border">{glyph.repeat(MAX_LEVEL - value)}</span>
    </span>
  );
}

type MemberCardProps = {
  member: RosterMember;
  uma: UmaSearchEntry | undefined;
  onRemove: () => void;
  onSetAce: () => void;
};

export const MemberCard = memo((props: MemberCardProps) => {
  const { member, uma, onRemove, onSetAce } = props;

  const aptitudes = uma?.aptitudes;
  const surfaceLetter = aptitudes?.[member.surface as keyof UmaAptitudes] ?? '?';
  const distanceLetter = aptitudes?.[member.distance as keyof UmaAptitudes] ?? '?';
  const name = uma?.name ?? 'Unknown';

  return (
    <div className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <img
          src={getUmaImageUrl(member.outfitId)}
          alt=""
          loading="lazy"
          className={cn(
            'size-9 shrink-0 rounded-full border-2 object-cover',
            member.isAce ? 'border-amber-400' : 'border-border'
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{name}</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            {uma?.outfit ?? member.outfitId}
          </div>
        </div>
        {member.isAce ? (
          <span className="shrink-0 rounded-full border border-amber-400/45 bg-amber-400/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-amber-600 dark:text-amber-400">
            ACE +10%
          </span>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Make ${name} the ace`}
                  onClick={onSetAce}
                  className="shrink-0 text-muted-foreground"
                />
              }
            >
              <CrownIcon />
            </TooltipTrigger>
            <TooltipContent>Make ace</TooltipContent>
          </Tooltip>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="shrink-0 text-muted-foreground"
        >
          <XIcon />
        </Button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
        <Pips label={`${name} stars`} value={member.stars} glyph="★" onClassName="text-amber-400" />
        <Pips
          label={`${name} potential`}
          value={member.potential}
          glyph="●"
          onClassName="text-sky-500 dark:text-sky-400"
        />
        <span>{STYLE_LABELS[member.style] ?? member.style}</span>
        <span className="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
          {surfaceLetter}/{distanceLetter}
        </span>
        <span className="text-sky-600 tabular-nums dark:text-sky-400">
          uniq {member.uniqueProcPoints.toLocaleString()}
        </span>
      </div>
    </div>
  );
});
