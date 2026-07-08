import type { TutorialStep } from '@/components/tutorial';

export const umalatorSteps: Array<TutorialStep> = [
  {
    title: 'Welcome to Torena Sim',
    description: (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">
          Torena Sim is an Umamusume race simulator that helps you optimize runner builds and
          compare performance.
        </p>
        <p className="text-muted-foreground">Let's run your first simulation together!</p>
      </div>
    ),
    showButtons: ['next', 'close']
  },
  {
    element: '[data-tutorial="runner-stats"]',
    title: 'Configure Your Runner',
    description: (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">These stats represent your runner's abilities:</p>
        <div className="flex flex-col gap-1">
          <div>
            <strong>Speed</strong>:{' '}
            <span className="text-muted-foreground">
              Affects the target speed of the runner during the late race and last spurt phases.
            </span>
          </div>
          <div>
            <strong>Stamina</strong>:
            <span className="text-muted-foreground">
              Used to calculate the HP that the runner will use for the race.
            </span>
          </div>
          <div>
            <strong>Power</strong>:{' '}
            <span className="text-muted-foreground">
              It affects how quickly the runner can accelerate to their top speed during any point
              in the race.
            </span>
          </div>
          <div>
            <strong>Guts</strong>:{' '}
            <span className="text-muted-foreground">
              Affects different bonuses the runner can get via the last spurt mechanic (not to be
              confused with the last spurt phase).
            </span>
          </div>
          <div>
            <strong>Wit</strong>:{' '}
            <span className="text-muted-foreground">
              Affects Skill activations, positioning, how likely they are to rush during the race
              and if they can increase Target Speed and decrease Stamina consumption during a
              downhill section.
            </span>
          </div>
        </div>

        <div>
          <a
            className="text-blue-500 hover:underline text-sm"
            href="https://gametora.com/umamusume/race-mechanics"
            target="_blank"
            rel="noopener noreferrer"
          >
            <small>Source: Gametora: Race Mechanics</small>
          </a>
        </div>

        <p className="text-muted-foreground">
          The default values are already set - we'll use these for now.
        </p>
      </div>
    ),
    side: 'right',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="skills-section"]',
    title: 'Add Skills',
    description: (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">
          Skills give your runner special abilities during the race.
        </p>
        <p className="text-muted-foreground">
          Click the <strong className="text-foreground">"Add Skills"</strong> button to select from
          available skills. Skills can activate at different race phases and provide various
          bonuses.
        </p>
        <p className="text-muted-foreground">
          For this tutorial, you can continue without adding skills, or add some to test their
          effects!
        </p>
      </div>
    ),
    side: 'right',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="race-settings"]',
    title: 'Race Conditions',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>Different conditions affect performance:</p>
        <div className="flex flex-col gap-1">
          <div>
            <strong className="text-foreground">Track</strong>: Venue and distance
          </div>
          <li>
            <strong className="text-foreground">Weather</strong>: Sunny, Cloudy, Rainy, Snowy
          </li>
          <li>
            <strong className="text-foreground">Season</strong>: Affects weather likelihood
          </li>
          <li>
            <strong className="text-foreground">Ground</strong>: Surface firmness (Firm is fastest)
          </li>
        </div>
        <p>We'll use the default conditions for this demo.</p>
      </div>
    ),
    side: 'top',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="simulation-controls"]',
    title: 'Run Your First Simulation',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>Time to run the simulation!</p>
        <p>
          <strong className="text-foreground">"Run all samples"</strong> will simulate the race
          multiple times (500+ runs) to get accurate statistics.
        </p>
        <p>
          <strong className="text-foreground">"Run one sample"</strong> runs a single quick
          simulation for testing.
        </p>
        <p>
          Click the green <strong className="text-foreground">"Run all samples"</strong> button to
          begin.
        </p>
      </div>
    ),
    side: 'bottom',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="race-visualization"]',
    title: 'Race Visualization',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>This visualization shows the race track with phase markers:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong className="text-foreground">Early-race</strong>: Initial positioning
          </li>
          <li>
            <strong className="text-foreground">Mid-race</strong>: Main race portion
          </li>
          <li>
            <strong className="text-foreground">Late-race</strong>: Approaching finish
          </li>
          <li>
            <strong className="text-foreground">Last spurt</strong>: Final sprint
          </li>
        </ul>
        <p>
          After running a simulation, you'll see the runner's position plotted throughout the race.
        </p>
      </div>
    ),
    side: 'bottom',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="results-tabs"]',
    title: 'View Your Results',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>After simulation, explore these tabs to analyze performance:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong className="text-foreground">Runner Stats</strong>: Finish times, top speeds, HP
            usage
          </li>
          <li>
            <strong className="text-foreground">Distribution</strong>: Statistical spread of results
          </li>
          <li>
            <strong className="text-foreground">Skills</strong>: When and how often skills activated
          </li>
        </ul>
        <p>The race visualization above shows your runner's position throughout the race.</p>
      </div>
    ),
    side: 'top',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    title: "You're All Set! 🎉",
    description: (
      <div className="flex flex-col gap-2">
        <div>Now you know the basics! Here are some next steps:</div>

        <div className="flex flex-col gap-2">
          <div className="font-semibold">Compare Runners</div>
          <ul className="text-muted-foreground list-disc list-inside space-y-1">
            <li>Tap the Compare B slot to configure a second runner</li>
            <li>Open "Field" to add more runners to the race (up to 12)</li>
            <li>Both compared umas race together for direct comparison</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <div className="font-semibold">Optimize Your Build</div>
          <ul className="text-muted-foreground list-disc list-inside space-y-1">
            <li>Try different skill combinations</li>
            <li>Adjust stats to find the best balance</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <div className="font-semibold">Advanced Analysis</div>
          <ul className="text-muted-foreground list-disc list-inside space-y-1">
            <li>
              Use "Compare Skills" to analyze individual skill effectiveness to add to your runner
              for race settings.
            </li>
            <li>
              Use "Compare Uniques" to find which Uma's Unique Skill is most effective for the race
              settings.
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">Save Your Work</h4>
          <ul className="text-muted-foreground list-disc list-inside space-y-1">
            <li>Use "Save to Veterans" to store favorite builds</li>
            <li>Load presets to quickly test different races</li>
          </ul>
        </div>
      </div>
    ),
    showButtons: ['close', 'next'],
    doneBtnText: 'Get Started!'
  }
];
