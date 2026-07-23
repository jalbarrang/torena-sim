import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useObservabilityConsent } from '@/modules/observability/observability';

export function AnalyticsConsentBanner() {
  const { configured, consent, grantConsent, denyConsent } = useObservabilityConsent();

  if (!configured || consent !== null) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-4">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-lg border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          We use privacy-friendly analytics to improve Torena Sim. Nothing is collected until you
          accept.{' '}
          <Link to="/privacy" className="text-primary hover:underline">
            Learn more
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={denyConsent}>
            Decline
          </Button>
          <Button size="sm" onClick={grantConsent}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
