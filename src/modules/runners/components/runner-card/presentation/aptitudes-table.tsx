import { AptitudeSelect } from '../../AptitudeSelect';
import { MoodSelect } from '../../MoodSelect';
import { StrategySelect } from '../../StrategySelect';
import { reconcileRunawayOnStrategyChange } from '../domain/runaway-policy';
import type { IRunnerState } from '../domain/runner-state';
import { updateCurrentSkills } from '@/modules/skills/store';
import { strategyNames } from '@/lib/uma-domain/runner/definitions';
import type { IMood, IStrategyName } from '@/lib/uma-domain/runner/definitions';
import { Label } from '@/components/ui/label';

export type Aptitude =
  | 'surfaceAptitude'
  | 'distanceAptitude'
  | 'strategy'
  | 'strategyAptitude'
  | 'mood';

type AptitudesTableProps = {
  value: IRunnerState;
  onChange: (value: IRunnerState) => void;
};

export const AptitudesTable = (props: AptitudesTableProps) => {
  const { value, onChange } = props;

  const handleUpdateAptitude = (prop: Aptitude) => (newValue: string) => {
    onChange({ ...value, [prop]: newValue });
  };

  const handleUpdateStrategy = () => (newValue: string | null) => {
    if (!newValue || !strategyNames.includes(newValue as IStrategyName)) {
      return;
    }

    const reconciled = reconcileRunawayOnStrategyChange(newValue as IStrategyName, value.skills);
    onChange({ ...value, strategy: reconciled.strategy, skills: reconciled.skills });
    if (reconciled.skills !== value.skills) {
      updateCurrentSkills(reconciled.skills);
    }
  };

  const handleUpdateMood = (prop: Aptitude) => (newValue: IMood) => {
    onChange({ ...value, [prop]: newValue });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <div className="flex items-center gap-2 border rounded-xl">
        <Label className="pl-2 w-24 text-xs">Surface aptitude:</Label>

        <AptitudeSelect
          value={value.surfaceAptitude}
          onChange={handleUpdateAptitude('surfaceAptitude')}
        />
      </div>

      <div className="flex items-center gap-2 border rounded-xl">
        <Label className="pl-2 w-24 text-xs">Distance aptitude:</Label>
        <AptitudeSelect
          value={value.distanceAptitude}
          onChange={handleUpdateAptitude('distanceAptitude')}
        />
      </div>

      <div className="flex items-center gap-2 border rounded-xl">
        <Label className="pl-2 w-24 text-xs">Style:</Label>
        <StrategySelect value={value.strategy} onChange={handleUpdateStrategy()} />
      </div>

      <div className="flex items-center gap-2 border rounded-xl">
        <Label className="pl-2 w-24 text-xs">Style aptitude:</Label>
        <AptitudeSelect
          value={value.strategyAptitude}
          onChange={handleUpdateAptitude('strategyAptitude')}
        />
      </div>

      <div className="flex items-center gap-2 border rounded-xl">
        <Label className="pl-2 w-24 text-xs">Mood:</Label>
        <MoodSelect value={value.mood} onChange={handleUpdateMood('mood')} />
      </div>
    </div>
  );
};
