import { Badge } from '@/components/ui/badge';
import { bannerAptitudes } from '@/modules/carat/data/banner-aptitudes';
import { bannerImageUrl } from '@/modules/carat/data/banner-image';
import { resolveBannerLabel } from '@/modules/carat/data/card-names';
import type { BannerPlanRow } from '@/modules/carat/model/plan';
import { windowText } from '@/modules/carat/components/banner-window-text';

type BannerIdentityProps = {
  row: BannerPlanRow;
  showWindow?: boolean;
};

export function BannerIdentity(props: BannerIdentityProps) {
  const { row, showWindow } = props;

  const aptitudes = bannerAptitudes(row.event);

  const cardType =
    row.event.card_type === 'character'
      ? 'Character'
      : row.event.card_type === 'support'
        ? 'Support Card'
        : '-';

  return (
    <div className="flex flex-col md:flex-row items-center gap-3">
      <img
        src={bannerImageUrl(row.event)}
        alt=""
        className="w-full md:w-auto h-auto md:h-20 shrink-0 object-cover ring-1 ring-foreground/10"
        loading="lazy"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <div className="truncate text-sm font-semibold">{resolveBannerLabel(row.event)}</div>
          {showWindow ? (
            <div className="truncate text-[11px] text-muted-foreground tabular-nums">
              {windowText(row.event)}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{cardType}</Badge>
          {aptitudes?.main.map((slot) => (
            <Badge key={slot.key} variant="secondary">
              {slot.label}
            </Badge>
          ))}
          {aptitudes?.secondary.map((slot) => (
            <Badge key={slot.key} variant="ghost" className="text-muted-foreground">
              {slot.label}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
