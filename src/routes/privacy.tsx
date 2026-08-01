import { useNavigate } from 'react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { config } from '@/config';

const LAST_UPDATED = '30 July 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function ServiceCard({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <span className="inline-block rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
        {tag}
      </span>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {children}
    </a>
  );
}

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6 text-muted-foreground"
          onClick={() => navigate('/')}
        >
          <ArrowLeftIcon className="mr-1.5" />
          Back
        </Button>

        <h1 className="text-3xl font-semibold">Privacy Policy</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Last updated {LAST_UPDATED} · Torena Sim
        </p>

        <div className="mt-7 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
          <span className="font-medium">The short version. </span>
          Your rosters, builds, and simulation settings stay in your own browser — we never upload
          or store them on a server. We do use privacy-friendly analytics and a few optional
          third-party services, described below.
        </div>

        <div className="mt-8 space-y-7">
          <Section title="1. Data stored on your device">
            <p>
              Everything you create — runners, builds, race-sim fields, course settings, and UI
              preferences — is saved locally in your browser via <code>localStorage</code>. It never
              leaves your machine unless you explicitly export or share it. Clearing your browser's
              site data removes it permanently.
            </p>
          </Section>

          <Section title="2. Analytics">
            <ServiceCard tag="PostHog">
              We use <ExternalLink href="https://posthog.com/privacy">PostHog</ExternalLink> to
              understand which features are used and to catch errors. It may collect anonymous usage
              events, your IP address, and basic device/browser information. We do not use it to
              identify you personally. See their policy for details and opt-out options.
            </ServiceCard>
          </Section>

          <Section title="3. Suggestions & feedback">
            <ServiceCard tag="Feedback form · Cloudflare Turnstile">
              If you submit feedback through the suggestion form, we send your message plus minimal
              metadata (the page you were on, the app version, and your browser's user-agent string)
              to our backend. The form is protected by{' '}
              <ExternalLink href="https://www.cloudflare.com/privacypolicy/">
                Cloudflare Turnstile
              </ExternalLink>{' '}
              for spam prevention.
            </ServiceCard>
          </Section>

          <Section title="4. Screenshot OCR (optional)">
            <ServiceCard tag="Shop screenshots · on-device OCR">
              Shop screenshots are processed inside your browser and are not sent to an OCR service.
              On first use, your browser downloads the OCR code and English recognition data from
              Torena Sim. Your browser may cache those same-origin assets for later use, but private
              browsing, cache eviction, or clearing site data can require another download.
              Screenshot pixels, filenames, and recognized text are excluded from our analytics
              capture.
            </ServiceCard>
            <ServiceCard tag="Runner screenshots · Google Gemini">
              Runner screenshot import is a separate server-assisted feature. When you actively use
              it, the image is sent through our Cloudflare Worker to the{' '}
              <ExternalLink href="https://ai.google.dev/gemini-api/terms">
                Google Gemini API
              </ExternalLink>{' '}
              using the service&apos;s shared credential. Cloudflare Turnstile protects the request.
              We do not store the uploaded image.
            </ServiceCard>
          </Section>

          <Section title="5. What we don't do">
            <ul className="list-disc space-y-1 pl-5">
              <li>No accounts, logins, or passwords.</li>
              <li>No selling or sharing of personal data with advertisers.</li>
              <li>No tracking across other websites.</li>
            </ul>
          </Section>

          <Section title="6. Contact">
            <p>
              Questions? Reach out to <span className="font-medium text-foreground">@albhax</span>{' '}
              on Discord, or open an issue on{' '}
              <ExternalLink href="https://github.com/jalbarrang/umalator-global">
                GitHub
              </ExternalLink>
              .
            </p>
          </Section>
        </div>

        <Separator className="my-8" />

        <p className="text-xs text-muted-foreground">
          Torena Sim is an independent, fan-made tool and is not affiliated with, endorsed by, or
          sponsored by Cygames, Inc.
        </p>

        <div className="mt-6">
          <a
            href={`${config.basePath}`}
            className="text-sm text-primary hover:underline"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            Return to Torena Sim
          </a>
        </div>
      </div>
    </div>
  );
}
