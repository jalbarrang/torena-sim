// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DebuffsPanel } from './DebuffsPanel';
import { skillsService } from '@/modules/data/services/SkillService';
import { useRaceStore } from '@/modules/simulation/stores/compare.store';
import { runawaySkillId } from '@/modules/runners/components/runner-card/domain/runaway-policy';
import { isInjectableExternalDebuffSkill } from '@/lib/uma-domain/skills/external-debuffs';

const pickerState = vi.hoisted(() => ({
  selectedSkills: [] as Array<string>,
  latestCurrentSkills: [] as Array<string>
}));

vi.mock('@/modules/skills/components/skill-picker/modal', () => ({
  SkillPickerModal: ({
    open,
    currentSkills,
    onSelect,
    onOpenChange
  }: {
    open: boolean;
    currentSkills: Array<string>;
    onSelect: (skills: Array<string>) => void;
    onOpenChange: (open: boolean) => void;
  }) => {
    pickerState.latestCurrentSkills = currentSkills;

    if (!open) {
      return null;
    }

    return (
      <div data-testid="skill-picker-modal">
        <button type="button" onClick={() => onSelect(pickerState.selectedSkills)}>
          Select mock debuff
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close mock debuff picker
        </button>
      </div>
    );
  }
}));

const initialDebuffsState = {
  uma1: [{ id: 'debuff-1', skillId: runawaySkillId, position: 100 }],
  uma2: []
};

const debuffSkillId =
  skillsService.getAll().find((skill) => isInjectableExternalDebuffSkill(skill))?.id ??
  runawaySkillId;

function resetDebuffs() {
  localStorage.clear();
  useRaceStore.setState({ injectedDebuffs: { uma1: [], uma2: [] } });
  pickerState.selectedSkills = [];
  pickerState.latestCurrentSkills = [];
}

describe('DebuffsPanel', () => {
  beforeEach(() => {
    resetDebuffs();
    useRaceStore.setState({ injectedDebuffs: initialDebuffsState });
  });

  afterEach(() => {
    cleanup();
    resetDebuffs();
  });

  it('updates an injected debuff position from the inline input', () => {
    render(<DebuffsPanel />);

    const input = screen.getByRole('spinbutton', { name: /position$/i });
    expect(input).toHaveValue(100);

    fireEvent.change(input, { target: { value: '140' } });

    expect(useRaceStore.getState().injectedDebuffs.uma1[0]?.position).toBe(140);
  });

  it('removes an injected debuff from the dismiss action', () => {
    render(<DebuffsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove skill' }));

    expect(useRaceStore.getState().injectedDebuffs.uma1).toHaveLength(0);
  });

  it('adds the selected debuff and resets picker state after closing', () => {
    render(<DebuffsPanel />);

    pickerState.selectedSkills = [debuffSkillId, `${debuffSkillId}-1`];

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Debuff' })[1]);
    expect(screen.getByTestId('skill-picker-modal')).toBeInTheDocument();
    expect(pickerState.latestCurrentSkills).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Select mock debuff' }));

    expect(useRaceStore.getState().injectedDebuffs.uma2).toHaveLength(1);
    expect(useRaceStore.getState().injectedDebuffs.uma2[0]?.skillId).toBe(debuffSkillId);
    expect(screen.queryByTestId('skill-picker-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Debuff' })[1]);
    expect(screen.getByTestId('skill-picker-modal')).toBeInTheDocument();
    expect(pickerState.latestCurrentSkills).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Close mock debuff picker' }));
    expect(screen.queryByTestId('skill-picker-modal')).not.toBeInTheDocument();
  });
});
