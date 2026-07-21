import { memo, useId } from 'react';
import { StarIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { getUmaImageUrl } from '@/modules/runners/utils';
import type { UmaSearchEntry } from '@/modules/runners/utils';
import {
  addOwnedTrainee,
  removeOwnedTrainee,
  setTraineePotential,
  setTraineeStars
} from '@/store/trainee-list.store';
import type { OwnedTrainee } from '@/store/trainee-list.store';
import { LevelPips } from './level-pips';

type TraineeTileProps = {
  uma: UmaSearchEntry;
  owned: OwnedTrainee | null;
};

const renderStarIcon = (filled: boolean) => (
  <StarIcon
    className={cn('size-4', filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
  />
);

const renderPotentialIcon = (filled: boolean) => (
  <span
    aria-hidden="true"
    className={cn(
      'text-sm leading-none',
      filled ? 'text-sky-500 dark:text-sky-400' : 'text-border'
    )}
  >
    ●
  </span>
);

export const TraineeTile = memo((props: TraineeTileProps) => {
  const { uma, owned } = props;

  const checkboxId = useId();
  const isOwned = owned !== null;

  const handleOwnedChange = (checked: boolean) => {
    if (checked) {
      addOwnedTrainee(uma.id, uma.rarity);
    } else {
      removeOwnedTrainee(uma.id);
    }
  };

  return (
    <div
      className={cn(
        'relative flex h-full flex-col items-center gap-1 rounded-lg border p-2 transition-colors',
        isOwned ? 'bg-card' : 'border-transparent'
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={isOwned}
        onCheckedChange={(checked) => handleOwnedChange(checked === true)}
        aria-label={`Own ${uma.outfit} ${uma.name}`}
        className="absolute top-2 left-2 z-10"
      />

      <label
        htmlFor={checkboxId}
        className="flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 text-center"
      >
        <img
          src={getUmaImageUrl(uma.id)}
          alt=""
          loading="lazy"
          className={cn('size-16 rounded', !isOwned && 'opacity-50 grayscale')}
        />

        <span
          className={cn(
            'block w-full truncate text-[10px] font-bold leading-tight',
            !isOwned && 'text-muted-foreground'
          )}
        >
          {uma.outfit}
        </span>
        <span
          className={cn(
            'block w-full truncate text-xs leading-tight',
            !isOwned && 'text-muted-foreground'
          )}
        >
          {uma.name}
        </span>
      </label>

      <div className={cn('mt-auto flex flex-col gap-0.5', !isOwned && 'invisible')}>
        <LevelPips
          label={`${uma.name} star level`}
          value={owned?.stars ?? uma.rarity}
          min={uma.rarity}
          readOnly={!isOwned}
          onChange={(stars) => setTraineeStars(uma.id, stars, uma.rarity)}
          renderIcon={renderStarIcon}
        />
        <LevelPips
          label={`${uma.name} potential level`}
          value={owned?.potential ?? 1}
          readOnly={!isOwned}
          onChange={(potential) => setTraineePotential(uma.id, potential)}
          renderIcon={renderPotentialIcon}
        />
      </div>
    </div>
  );
});
