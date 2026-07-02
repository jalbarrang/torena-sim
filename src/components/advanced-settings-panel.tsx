import { useMemo } from 'react';
import type { WitVarianceSettings } from '@/store/settings.store';
import {
  setStaminaDrainOverride,
  setSamples,
  setWitVariance,
  useSettingsStore,
  useStaminaDrainOverrides,
  useWitVariance
} from '@/store/settings.store';
import { useComparePairRunners } from '@/store/runners.store';
import { useComparePairNames } from '@/modules/runners/hooks/use-compare-names';
import { SkillType } from '@/lib/uma-domain/skills/definitions';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@/components/ui/panel';
import { Separator } from '@/components/ui/separator';
import { skillsService } from '@/modules/data/services/SkillService';
import { isSupportedMultiplyRandomRecoveryDrain } from '@/lib/uma-domain/skills/recovery-effect-utils';
import {
  setIgnoreStaminaConsumption,
  useSkillPlannerStore
} from '@/modules/skill-planner/skill-planner.store';

type DrainSkillMeta = {
  skillId: string;
  name: string;
  drainPercent: number;
};

const FALLBACK_OVERRIDE_PERCENT = 45;

const WitVarianceSettingRow = ({
  label,
  uma1Key,
  uma2Key,
  settings,
  onToggle,
  disabled
}: {
  label: string;
  uma1Key: keyof WitVarianceSettings;
  uma2Key: keyof WitVarianceSettings;
  settings: WitVarianceSettings;
  onToggle: (key: keyof WitVarianceSettings) => void;
  disabled?: boolean;
}) => {
  const names = useComparePairNames();

  return (
  <div className="flex items-center justify-between py-2">
    <span className={`text-sm ${disabled ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
      {label}
    </span>
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span
          className={`max-w-24 truncate text-xs ${disabled ? 'opacity-50' : ''}`}
          style={{ color: 'rgb(42, 119, 197)' }}
        >
          {names.uma1}
        </span>
        <Checkbox
          checked={settings[uma1Key]}
          onCheckedChange={() => onToggle(uma1Key)}
          disabled={disabled}
        />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`max-w-24 truncate text-xs ${disabled ? 'opacity-50' : ''}`}
          style={{ color: 'rgb(197, 42, 42)' }}
        >
          {names.uma2}
        </span>
        <Checkbox
          checked={settings[uma2Key]}
          onCheckedChange={() => onToggle(uma2Key)}
          disabled={disabled}
        />
      </div>
    </div>
  </div>
  );
};

export const AdvancedSettingsPanel = () => {
  const { nsamples } = useSettingsStore();
  const { uma1, uma2 } = useComparePairRunners();
  const ignoreStaminaConsumption = useSkillPlannerStore((state) => state.ignoreStaminaConsumption);
  const witVarianceSettings = useWitVariance();
  const staminaDrainOverrides = useStaminaDrainOverrides();

  const handleSimWitVarianceToggle = () => {
    setWitVariance({ simWitVariance: !witVarianceSettings.simWitVariance });
  };

  const toggleWitVarianceSetting = (setting: keyof WitVarianceSettings) => {
    setWitVariance({ [setting]: !witVarianceSettings[setting] });
  };

  const drainSkills = useMemo<Array<DrainSkillMeta>>(() => {
    const uniqueSkillIds = new Set<string>();
    const rows: Array<DrainSkillMeta> = [];
    const equippedSkills = [...uma1.skills, ...uma2.skills];

    for (const equippedSkillId of equippedSkills) {
      const baseSkillId = equippedSkillId.split('-', 1)[0] ?? equippedSkillId;
      if (uniqueSkillIds.has(baseSkillId)) {
        continue;
      }

      uniqueSkillIds.add(baseSkillId);

      try {
        const skill = skillsService.getById(baseSkillId);
        if (!skill) {
          continue;
        }
        let maxDrainPercent = 0;

        for (const alternative of skill.alternatives) {
          for (const effect of alternative.effects) {
            if (effect.type !== SkillType.Recovery || effect.modifier >= 0) {
              continue;
            }

            if (isSupportedMultiplyRandomRecoveryDrain(effect)) {
              continue;
            }

            maxDrainPercent = Math.max(maxDrainPercent, Math.abs(effect.modifier) / 100);
          }
        }

        if (maxDrainPercent <= 0) {
          continue;
        }

        rows.push({
          skillId: baseSkillId,
          name: skill.name,
          drainPercent: maxDrainPercent
        });
      } catch {
        // Ignore unknown skill IDs in persisted runner data.
      }
    }

    return rows.toSorted((a, b) => b.drainPercent - a.drainPercent || a.name.localeCompare(b.name));
  }, [uma1.skills, uma2.skills]);

  const toggleDrainOverride = (skillId: string, enabled: boolean) => {
    if (!enabled) {
      setStaminaDrainOverride(skillId, null);
      return;
    }

    const nextValue = staminaDrainOverrides[skillId] ?? FALLBACK_OVERRIDE_PERCENT / 100;
    setStaminaDrainOverride(skillId, nextValue);
  };

  const updateDrainOverride = (skillId: string, value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }

    const clampedPercent = Math.min(Math.max(parsed, 0), 100);
    setStaminaDrainOverride(skillId, clampedPercent / 100);
  };

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Advanced Settings</PanelTitle>
      </PanelHeader>

      <PanelContent className="flex flex-col gap-4">
        {/* Samples */}
        <div className="flex items-center gap-3">
          <Label htmlFor="nsamples" className="w-20">
            Samples:
          </Label>
          <Input
            type="number"
            id="nsamples"
            min="1"
            max="10000"
            value={nsamples}
            onInput={(e) => setSamples(+e.currentTarget.value)}
            className="flex-1"
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <Label htmlFor="ignoreStaminaConsumption" className="text-sm font-semibold">
            Ignore stamina consumption
          </Label>
          <Checkbox
            id="ignoreStaminaConsumption"
            checked={ignoreStaminaConsumption}
            onCheckedChange={(checked) => setIgnoreStaminaConsumption(checked === true)}
          />
        </div>

        <Separator />

        {/* Wit Variance */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="simWitVariance" className="text-sm font-semibold">
              Wit Variance
            </Label>
            <Checkbox
              id="simWitVariance"
              checked={witVarianceSettings.simWitVariance}
              onCheckedChange={handleSimWitVarianceToggle}
            />
          </div>

          <div className="pl-2 border-l-2 border-muted">
            <WitVarianceSettingRow
              label="Rushed State"
              uma1Key="allowRushedUma1"
              uma2Key="allowRushedUma2"
              settings={witVarianceSettings}
              onToggle={toggleWitVarianceSetting}
              disabled={!witVarianceSettings.simWitVariance}
            />
            <WitVarianceSettingRow
              label="Downhill Mode"
              uma1Key="allowDownhillUma1"
              uma2Key="allowDownhillUma2"
              settings={witVarianceSettings}
              onToggle={toggleWitVarianceSetting}
              disabled={!witVarianceSettings.simWitVariance}
            />
            <WitVarianceSettingRow
              label="Power Conservation"
              uma1Key="allowConservePowerUma1"
              uma2Key="allowConservePowerUma2"
              settings={witVarianceSettings}
              onToggle={toggleWitVarianceSetting}
            />
            <WitVarianceSettingRow
              label="Section Modifier"
              uma1Key="allowSectionModifierUma1"
              uma2Key="allowSectionModifierUma2"
              settings={witVarianceSettings}
              onToggle={toggleWitVarianceSetting}
              disabled={!witVarianceSettings.simWitVariance}
            />
            <WitVarianceSettingRow
              label="Skill Check Chance"
              uma1Key="allowSkillCheckChanceUma1"
              uma2Key="allowSkillCheckChanceUma2"
              settings={witVarianceSettings}
              onToggle={toggleWitVarianceSetting}
              disabled={!witVarianceSettings.simWitVariance}
            />
          </div>
        </div>

        <Separator />

        {/* Stamina Drain Overrides */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-semibold">Stamina Drain Overrides</Label>
          {drainSkills.length === 0 ? (
            <span className="text-sm text-muted-foreground">No manual drain overrides needed</span>
          ) : (
            <div className="flex flex-col gap-2">
              {drainSkills.map((skill) => {
                const overrideValue = staminaDrainOverrides[skill.skillId];
                const isEnabled = overrideValue != null;
                const overridePercent = (overrideValue ?? FALLBACK_OVERRIDE_PERCENT / 100) * 100;

                return (
                  <div
                    key={skill.skillId}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium leading-tight">{skill.name}</span>
                        <span className="text-xs text-muted-foreground">
                          Original drain: {skill.drainPercent.toFixed(2)}%
                        </span>
                      </div>
                      <Checkbox
                        checked={isEnabled}
                        onCheckedChange={(checked) =>
                          toggleDrainOverride(skill.skillId, checked === true)
                        }
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label htmlFor={`drain-override-${skill.skillId}`} className="w-28 text-xs">
                        Override (%):
                      </Label>
                      <Input
                        id={`drain-override-${skill.skillId}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        disabled={!isEnabled}
                        value={overridePercent}
                        onInput={(event) =>
                          updateDrainOverride(skill.skillId, event.currentTarget.value)
                        }
                        className="max-w-32"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PanelContent>
    </Panel>
  );
};
