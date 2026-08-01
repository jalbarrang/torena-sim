import type { TutorialStep } from '@/components/tutorial';

const HighlightedText = ({ children }: { children: React.ReactNode }) => {
  return <code className="text-foreground font-mono p-2 rounded-md bg-muted">{children}</code>;
};

export const getSkillBassinSteps = (showLPerSP: boolean): Array<TutorialStep> => [
  {
    title: 'Welcome to Compare Skills! 📊',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          Compare Skills helps you analyze and compare the effectiveness of individual skills in
          your runner's build.
        </div>
        <div>Let's explore how to use this powerful analysis tool!</div>
      </div>
    ),
    showButtons: ['next', 'close']
  },
  {
    element: '[data-tutorial="skill-bassin-controls"]',
    title: 'Running Skill Simulations',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>This section allows you to run simulations that analyze individual skills.</div>

        <div>
          If your runner doesn't have any skills configured, you can add some now, or just continue
          without adding any skills.
        </div>

        <div>
          The simulator will run multiple samples for each skill in the pool to get measurements of
          the skill's effectiveness for the race settings and runner.
        </div>

        <div>
          Click <strong className="text-foreground">"Run Skill Simulations"</strong> to start
          running the simulations.
        </div>
      </div>
    ),
    side: 'bottom',
    align: 'start',
    showButtons: ['previous', 'next', 'close']
  },
  {
    element: '[data-tutorial="skill-bassin-table"]',
    title: 'Skill Comparison Table',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>After running simulations, this table shows statistics for each skill:</div>

        <ul className="list-disc list-inside space-y-1 mb-3">
          <li>
            <strong className="text-foreground">Skill Name</strong>: The skill being analyzed
          </li>
          {showLPerSP && (
            <li>
              <strong className="text-foreground">L / SP</strong>: Lengths gained per skill point
              spent — factors in hints, Fast Learner, and prerequisite costs
            </li>
          )}
          <li>
            <strong className="text-foreground">Minimum/Maximum</strong>: Best and worst performance
            with the skill
          </li>
          <li>
            <strong className="text-foreground">Mean</strong>: Average performance improvement
          </li>
          <li>
            <strong className="text-foreground">Median</strong>: Middle value of all runs
          </li>
        </ul>

        <div>Click on column headers to sort by different metrics.</div>
      </div>
    ),
    side: 'top',
    align: 'center',
    showButtons: ['previous', 'next', 'close']
  },
  {
    title: 'Understanding the Results 💡',
    description: (
      <div className="flex flex-col gap-2 text-muted-foreground">
        <div>
          Compare Skills runs multiple simulations comparing your runner <strong>with</strong> and{' '}
          <strong>without</strong> each skill to measure its impact.
        </div>

        <div className="font-semibold text-foreground">Tips for Analysis:</div>

        <ul className="list-disc list-inside space-y-1 mb-3">
          {showLPerSP && (
            <li>
              Higher <HighlightedText>L / SP</HighlightedText> values indicate the best skill point
              investment
            </li>
          )}
          <li>
            Higher <HighlightedText>mean</HighlightedText> values indicate more effective skills
          </li>
          <li>
            Large difference between <HighlightedText>min</HighlightedText> /{' '}
            <HighlightedText>max</HighlightedText> suggests skill inconsistency
          </li>
          <li>Use this data to optimize your skill selection for the selected runner.</li>
        </ul>

        <div>
          Combine this with the main Umalator comparison to measure two runners so you can choose
          which runner works best for the race settings.
        </div>
      </div>
    ),
    showButtons: ['close', 'next'],
    doneBtnText: 'Got it!'
  }
];
