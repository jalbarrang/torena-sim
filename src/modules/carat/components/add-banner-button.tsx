import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AddBannerDialog } from '@/modules/carat/components/add-banner-dialog';
import { fetchTimeline } from '@/modules/carat/data/timeline-client';

type AddBannerButtonProps = {
  showFirstVisitNudge?: boolean;
};

export function AddBannerButton(props: AddBannerButtonProps) {
  const { showFirstVisitNudge = false } = props;
  const timelineQuery = useQuery({
    queryKey: ['caratTimeline'],
    queryFn: fetchTimeline,
    staleTime: 5 * 60 * 1000
  });

  if (!timelineQuery.data) {
    return (
      <Button
        data-tutorial="carat-add-banner"
        disabled
        variant={showFirstVisitNudge ? 'secondary' : 'default'}
      >
        + Add banner from timeline
      </Button>
    );
  }

  return (
    <AddBannerDialog timeline={timelineQuery.data} showFirstVisitNudge={showFirstVisitNudge} />
  );
}
