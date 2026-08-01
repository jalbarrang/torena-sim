import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useSkillBasinPoolRunner } from '@/modules/simulation/hooks/pool/useSkillBasinPoolRunner';
import {
  createNewSkillBassinSeed,
  resetTable,
  setSkillBassinSeed,
  useChartData,
  useSkillBasinStore
} from '@/modules/simulation/stores/skill-basin.store';
import { BasinnChart } from '@/components/bassin-chart/BasinnChart';
import { SimulationControlBar } from '@/components/simulation-control-bar';
import { setSkillToRunner, useRunner } from '@/store/runners.store';
import { useSettingsStore } from '@/store/settings.store';
import { RaceSettingsPanel } from '@/modules/skill-planner/components/RaceSettingsPanel';
import { useSkillSingleRunner } from '@/modules/simulation/hooks/skill-bassin/useSkillSingleRunner';
import { getSkillBassinSteps } from '@/modules/tutorial/steps/skill-bassin-steps';
import { coursesService } from '@/modules/data/services/CourseService';
import { TutorialId } from '@/components/tutorial/types';
import { SimulationProgressBanner } from '@/components/simulation-progress-banner';
import { SkillSelectorDialog } from '@/modules/simulation/components/skill-selector-dialog';
import {
  getSkillPlanningMeta,
  useSkillPlannerStore
} from '@/modules/skill-planner/skill-planner.store';
import { useFeature } from '@/lib/feature-flags';

export default function SkillComparePage() {
  const { selectedSkills, setSelectedSkills } = useChartData();
  const {
    results: skillBasinResults,
    isSimulationRunning,
    seed,
    skillLoadingStates
  } = useSkillBasinStore(
    useShallow((state) => {
      return {
        results: state.results,
        isSimulationRunning: state.isSimulationRunning,
        seed: state.seed,
        skillLoadingStates: state.skillLoadingStates
      };
    })
  );

  const courseId = useSettingsStore(useShallow((state) => state.courseId));
  const hasFastLearner = useSkillPlannerStore((state) => state.hasFastLearner);
  const showLPerSP = useFeature('BASSIN_L_PER_SP_ENABLED');
  const { runnerId, runner } = useRunner();

  const course = useMemo(() => coursesService.getSimCourse(courseId), [courseId]);

  const basinnChartSelection = (skillId: string) => {
    const results = skillBasinResults[skillId];

    if (results?.runData) {
      setSelectedSkills((prev) => {
        if (prev.includes(skillId)) {
          return prev.filter((id) => id !== skillId);
        }

        return [...prev, skillId];
      });
    }
  };

  const arrayResults = useMemo(() => {
    return Object.values(skillBasinResults);
  }, [skillBasinResults]);

  const resultCount = useMemo(() => {
    return arrayResults.length;
  }, [arrayResults]);

  const addSkillFromTable = (skillId: string) => {
    setSkillToRunner(runnerId, skillId);
  };

  const { doBasinnChart, cancelSimulation } = useSkillBasinPoolRunner();
  const { runAdditionalSamples } = useSkillSingleRunner();

  const tutorialSettings = useMemo(() => {
    return {
      id: 'skill-bassin' as TutorialId,
      steps: getSkillBassinSteps(showLPerSP),
      tooltip: 'How to use Compare Skills'
    };
  }, [showLPerSP]);

  return (
    <div className="flex flex-col gap-4 flex-1 min-w-0">
      <RaceSettingsPanel />

      <SimulationControlBar
        isRunning={isSimulationRunning}
        seed={seed}
        onRun={doBasinnChart}
        onCancel={cancelSimulation}
        onReplay={doBasinnChart}
        onClear={resetTable}
        clearDisabled={resultCount === 0}
        createSeed={createNewSkillBassinSeed}
        setSeed={setSkillBassinSeed}
        tutorial={tutorialSettings}
        dataTutorial="skill-bassin-controls"
      />

      <div>
        <SkillSelectorDialog />
      </div>

      <div data-tutorial="skill-bassin-table" className="min-w-0">
        <SimulationProgressBanner useStore={useSkillBasinStore} />

        <BasinnChart
          data={arrayResults}
          hiddenSkills={runner.skills}
          onSelectionChange={basinnChartSelection}
          onAddSkill={addSkillFromTable}
          selectedSkills={selectedSkills}
          isSimulationRunning={isSimulationRunning}
          courseDistance={course.distance}
          currentSeed={seed}
          skillLoadingStates={skillLoadingStates}
          onRunAdditionalSamples={runAdditionalSamples}
          hasFastLearner={hasFastLearner}
          showLPerSP={showLPerSP}
          getSkillMeta={getSkillPlanningMeta}
          className="min-w-0"
        />
      </div>
    </div>
  );
}
