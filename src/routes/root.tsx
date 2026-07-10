import { Route, Routes, useNavigate } from 'react-router';

import { Link } from 'react-router';
import { Fragment } from 'react';
import {
  setShowChangelogModal,
  setShowCreditsModal,
  setShowSuggestionModal
} from '@/store/ui.store';
import { Toaster } from '@/components/ui/sonner';
import { AnalyticsConsentBanner } from '@/components/analytics-consent-banner';
import { PageMetadata } from '@/components/seo/page-metadata';
import { Button } from '@/components/ui/button';
import { ChangelogModal } from '@/components/changelog-modal';
import { CreditsModal } from '@/components/credits-modal';
import { SuggestionModal } from '@/components/suggestion-modal';
import { TutorialProvider, TutorialRoot } from '@/components/tutorial';
import { Navbar } from '@/modules/app/components/navbar';
import { ImportCodeDialog } from '@/modules/runners/share/import-code-dialog';
import { useRoosterImport } from '@/modules/runners/share/use-rooster-import';
import { getCompareFieldId, setRunner } from '@/store/runners.store';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import type { IRunnerState } from '@/modules/runners/components/runner-card/types';
import { toast } from 'sonner';
import { scan } from 'react-scan';

import { Suspense, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

// Layouts
import { SimulationLayout } from './_simulation';
import { RunnersLayout } from './runners';
import { RaceSimRoot } from './race-sim';

// Pages
// Compare
import SimulationHome from './_simulation/home';
import SkillBassin from './_simulation/skill-bassin';
import UmaBassin from './_simulation/uma-bassin';
// Skill Planner
import SkillPlanner from './skill-planner';
// Roster
import RunnersHome from './runners/home';
import RunnersNew from './runners/new';
import RunnersEdit from './runners/$runnerId.edit';
// Race Simulation
import RaceSimHome from './race-sim/home';
import RaceSimRun from './race-sim/run';
import RaceSimResults from './race-sim/results';
// Tools
import { SkillsPage } from './_tools/skills';
import { SkillVisualizerPage } from './_tools/skill-visualizer';
import { SparkOddsPage } from './_tools/spark-odds';
import { CaratCalculatorPage } from './_tools/carat-calculator';

import { SupportCardsPage } from './_tools/support-cards';
import PrivacyPolicy from './privacy';
import { config } from '@/config';

type RoutePageProps = {
  title: string;
  description: string;
  noindex?: boolean;
  children: ReactNode;
};

function RoutePage({ title, description, noindex = false, children }: RoutePageProps) {
  return (
    <>
      <PageMetadata title={title} description={description} noindex={noindex} />
      {children}
    </>
  );
}

export function RootComponent() {
  const { importCode, dialogOpen, setDialogOpen } = useRoosterImport();

  const handleRoosterImport = useCallback(
    (slot: 'uma1' | 'uma2', partialRunner: Partial<IRunnerState>) => {
      const fullRunner = createRunnerState(partialRunner);
      setRunner(getCompareFieldId(slot), fullRunner);
      setDialogOpen(false);
      toast.success(`Runner loaded to ${slot === 'uma1' ? 'Compare A' : 'Compare B'}`);
    },
    [setDialogOpen]
  );

  // useScan() has a bug where it ignores `enabled` and always calls start(),
  // so we use scan() directly which properly respects the enabled flag
  useEffect(() => {
    scan({ enabled: config.reactScan });
  }, []);

  return (
    <TutorialProvider>
      <div className="flex flex-col h-dvh">
        <Navbar />

        <main className="flex flex-1 overflow-hidden min-h-0">
          <Routes>
            <Route path="/" element={<SimulationLayout />}>
              <Route
                index
                element={
                  <RoutePage title="Compare Builds" description="">
                    <SimulationHome />
                  </RoutePage>
                }
              />
              <Route
                path="/skill-bassin"
                element={
                  <RoutePage title="Compare Skills" description="">
                    <SkillBassin />
                  </RoutePage>
                }
              />
              <Route
                path="/uma-bassin"
                element={
                  <RoutePage title="Compare Uniques" description="">
                    <UmaBassin />
                  </RoutePage>
                }
              />
            </Route>

            <Route path="/runners" element={<RunnersLayout />}>
              <Route
                index
                element={
                  <RoutePage title="Roster" description="">
                    <RunnersHome />
                  </RoutePage>
                }
              />
              <Route
                path="/runners/new"
                element={
                  <RoutePage title="Add Runner" description="" noindex>
                    <RunnersNew />
                  </RoutePage>
                }
              />
              <Route
                path="/runners/:runnerId/edit"
                element={
                  <RoutePage title="Edit Runner" description="" noindex>
                    <RunnersEdit />
                  </RoutePage>
                }
              />
            </Route>

            <Route path="/race-sim" element={<RaceSimRoot />}>
              <Route
                index
                element={
                  <RoutePage title="9-runner race sim" description="">
                    <RaceSimHome />
                  </RoutePage>
                }
              />
              <Route
                path="/race-sim/run"
                element={
                  <RoutePage title="Race Sim - Playback" description="" noindex>
                    <RaceSimRun />
                  </RoutePage>
                }
              />
              <Route
                path="/race-sim/results"
                element={
                  <RoutePage title="Race Sim - Results" description="" noindex>
                    <RaceSimResults />
                  </RoutePage>
                }
              />
            </Route>

            <Route
              path="/skill-planner"
              element={
                <RoutePage title="Skill Planner" description="">
                  <SkillPlanner />
                </RoutePage>
              }
            />

            <Route
              path="/skills"
              element={
                <RoutePage title="Skills" description="Browse all skills">
                  <SkillsPage />
                </RoutePage>
              }
            />

            <Route
              path="/skill-visualizer"
              element={
                <RoutePage
                  title="Skill Visualizer"
                  description="Visualize where skill conditions activate on each track"
                >
                  <SkillVisualizerPage />
                </RoutePage>
              }
            />

            <Route path="/spark-odds" element={<SparkOddsPage />} />

            <Route
              path="/carat-calculator"
              element={
                <RoutePage
                  title="Carat Calculator"
                  description="Plan your gacha pulls against the live banner timeline"
                >
                  <CaratCalculatorPage />
                </RoutePage>
              }
            />

            <Route
              path="/privacy"
              element={
                <RoutePage title="Privacy Policy" description="How Torena Sim handles your data">
                  <PrivacyPolicy />
                </RoutePage>
              }
            />

            <Route
              path="/support-cards"
              element={
                <RoutePage title="Support Cards" description="Browse support card data" noindex>
                  <Suspense fallback={null}>
                    <SupportCardsPage />
                  </Suspense>
                </RoutePage>
              }
            />

            {/* Catch all route */}
            <Route path="*" element={<NotFoundComponent />} />
          </Routes>
        </main>

        <AppFooter />

        <AnalyticsConsentBanner />
        <CreditsModal />
        <ChangelogModal />
        <SuggestionModal />

        <ImportCodeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initialCode={importCode}
          mode="slot-picker"
          onLoadToSlot={handleRoosterImport}
        />
      </div>
      <Toaster />
      <TutorialRoot />
    </TutorialProvider>
  );
}

const footerLinkClass = 'hover:text-foreground hover:underline';

function AppFooter() {
  const showSuggestions = Boolean(
    config.suggestions.workerUrl && config.suggestions.turnstileSiteKey
  );

  const links = [
    <Link key="privacy" to="/privacy" className={footerLinkClass}>
      Privacy Policy
    </Link>,
    <button
      key="credits"
      type="button"
      className={footerLinkClass}
      onClick={() => setShowCreditsModal(true)}
    >
      Credits
    </button>,
    <button
      key="changelog"
      type="button"
      className={footerLinkClass}
      onClick={() => setShowChangelogModal(true)}
    >
      Changelog
    </button>,
    showSuggestions ? (
      <button
        key="suggestions"
        type="button"
        className={footerLinkClass}
        onClick={() => setShowSuggestionModal(true)}
      >
        Suggestions
      </button>
    ) : null,
    <a
      key="github"
      href="https://github.com/jalbarrang/torena-sim"
      target="_blank"
      rel="noopener noreferrer"
      className={footerLinkClass}
    >
      GitHub
    </a>,
    <a
      key="discord"
      href="https://discord.gg/qJ7EJTJtT7"
      target="_blank"
      rel="noopener noreferrer"
      className={footerLinkClass}
    >
      Discord
    </a>
  ].filter(Boolean);

  return (
    <footer className="shrink-0 border-t px-4 py-1.5 text-xs text-muted-foreground">
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
          {links.map((link, index) => (
            <Fragment key={link!.key}>
              {index > 0 && <span aria-hidden="true">·</span>}
              {link}
            </Fragment>
          ))}
        </span>
        <span>This website is not affiliated with Cygames, Inc.</span>
      </div>
    </footer>
  );
}

function NotFoundComponent() {
  const navigate = useNavigate();

  return (
    <>
      <PageMetadata
        title="Page Not Found"
        description="The requested page could not be found."
        noindex
      />
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h1 className="text-6xl font-semibold">404</h1>
          <h2 className="text-2xl font-semibold">Page Not Found</h2>
          <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
          <div className="flex gap-2 justify-center pt-4">
            <Button onClick={() => navigate('/')}>Go to Home</Button>
          </div>
        </div>
      </div>
    </>
  );
}
