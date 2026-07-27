import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  getActivePlan,
  removePlannedBanner,
  restorePlannedBanner,
  useCaratStore
} from '@/store/carat.store';

type RemovePlannedBannerButtonProps = {
  bannerId: string;
  bannerLabel: string;
  label?: boolean;
};

export function RemovePlannedBannerButton(props: RemovePlannedBannerButtonProps) {
  const { bannerId, bannerLabel, label = false } = props;

  const handleRemove = () => {
    const banner = getActivePlan(useCaratStore.getState()).plannedBanners.find(
      (planned) => planned.id === bannerId
    );
    if (!banner) return;

    removePlannedBanner(bannerId);
    toast(`Removed ${bannerLabel}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => restorePlannedBanner(banner)
      }
    });
  };

  return (
    <Button
      type="button"
      size={label ? 'sm' : 'icon-sm'}
      variant={label ? 'destructive' : 'ghost'}
      onClick={handleRemove}
      aria-label={`Remove ${bannerLabel}`}
    >
      {label ? 'Remove' : <Trash2 />}
    </Button>
  );
}
