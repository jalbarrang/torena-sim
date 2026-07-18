// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FieldManagerContent } from './field-manager-content';
import { useRunnersStore, MAX_RUNNERS, MIN_RUNNERS } from '@/store/runners.store';
import {
  useRaceStore,
  DEFAULT_COMPARE_MODE,
  DEFAULT_FIELD_SIZE,
  MIN_FIELD_SIZE
} from '@/modules/simulation/stores/compare.store';
import { createRunnerState } from '@/modules/runners/components/runner-card/types';
import type { FieldRunner } from '@/store/runners.store';

const makeRunner = (fieldId: string): FieldRunner => ({
  ...createRunnerState(),
  fieldId
});

const seedField = (count: number) => {
  const runners = Array.from({ length: count }, (_, i) => makeRunner(`r-${i}`));
  useRunnersStore.setState({
    runners,
    compareA: 'r-0',
    compareB: 'r-1',
    editingId: 'r-0'
  });
};

const resetStores = () => {
  localStorage.clear();
  seedField(2);
  useRaceStore.setState({
    compareMode: DEFAULT_COMPARE_MODE,
    fieldSize: DEFAULT_FIELD_SIZE
  });
};

beforeEach(resetStores);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FieldManagerContent (manage mode)', () => {
  it('disables the add button at MAX_RUNNERS', () => {
    seedField(MAX_RUNNERS);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /add uma to field/i })).toBeDisabled();
  });

  it('disables remove buttons at MIN_RUNNERS', () => {
    seedField(MIN_RUNNERS);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    for (const button of screen.getAllByRole('button', { name: /remove .* from field/i })) {
      expect(button).toBeDisabled();
    }
  });

  it('adds a runner and grows the field', () => {
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /add uma to field/i }));

    expect(useRunnersStore.getState().runners).toHaveLength(3);
  });

  it('removes a context runner without touching the compare pair', () => {
    seedField(3);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    const removeButtons = screen.getAllByRole('button', { name: /remove .* from field/i });
    fireEvent.click(removeButtons[2]);

    const state = useRunnersStore.getState();
    expect(state.runners).toHaveLength(2);
    expect(state.compareA).toBe('r-0');
    expect(state.compareB).toBe('r-1');
  });

  it('assigning a role radio displaces the previous holder', () => {
    seedField(3);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    // Third runner takes slot A.
    const radios = screen.getAllByRole('button', { name: /set .* as compare a/i });
    fireEvent.click(radios[2]);

    const state = useRunnersStore.getState();
    expect(state.compareA).toBe('r-2');
    expect(state.compareB).toBe('r-1');
  });

  it('hides the vacuum mode control at 3+ runners', () => {
    seedField(2);
    const { unmount } = render(<FieldManagerContent pickRole={null} onClose={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: /compare mode/i })).toBeInTheDocument();
    unmount();

    seedField(3);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);
    expect(screen.queryByRole('radiogroup', { name: /compare mode/i })).not.toBeInTheDocument();
  });

  it('clicking Vacuum sets compare mode', () => {
    seedField(2);
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('radio', { name: /^vacuum$/i }));

    expect(useRaceStore.getState().compareMode).toBe('vacuum');
  });

  it('disables field-size controls in vacuum mode', () => {
    seedField(2);
    useRaceStore.setState({ compareMode: 'vacuum', fieldSize: DEFAULT_FIELD_SIZE });
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /decrease field size/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /increase field size/i })).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });

  it('steps the field size with the +/- controls and clamps at bounds', () => {
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /decrease field size/i }));
    expect(useRaceStore.getState().fieldSize).toBe(DEFAULT_FIELD_SIZE - 1);

    fireEvent.click(screen.getByRole('button', { name: /increase field size/i }));
    expect(useRaceStore.getState().fieldSize).toBe(DEFAULT_FIELD_SIZE);
  });

  it('accepts a typed field size, clamped into range', () => {
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '99' } });
    expect(useRaceStore.getState().fieldSize).toBe(12);

    fireEvent.change(input, { target: { value: '1' } });
    expect(useRaceStore.getState().fieldSize).toBe(MIN_FIELD_SIZE);
  });

  it('describes the mob padding for the current field', () => {
    seedField(2);
    useRaceStore.setState({ fieldSize: 9 });
    render(<FieldManagerContent pickRole={null} onClose={() => {}} />);

    expect(screen.getByText(/2 umas \+ 7 filler mobs/i)).toBeInTheDocument();
  });
});

describe('FieldManagerContent (pick mode)', () => {
  it('assigns the tapped runner to the picked slot and closes', () => {
    seedField(3);
    const onClose = vi.fn();
    render(<FieldManagerContent pickRole="uma1" onClose={onClose} />);

    // Rows are identity buttons in pick mode; the third runner is a context runner.
    const rows = screen.getAllByRole('button', { name: /new runner/i });
    fireEvent.click(rows[2]);

    const state = useRunnersStore.getState();
    expect(state.compareA).toBe('r-2');
    expect(state.editingId).toBe('r-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('add row creates a new uma directly into the picked slot', () => {
    const onClose = vi.fn();
    render(<FieldManagerContent pickRole="uma2" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /new uma as compare b/i }));

    const state = useRunnersStore.getState();
    expect(state.runners).toHaveLength(3);
    expect(state.compareB).toBe(state.runners[2].fieldId);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides manage-only controls in pick mode', () => {
    render(<FieldManagerContent pickRole="uma1" onClose={() => {}} />);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove .* from field/i })).not.toBeInTheDocument();
  });
});
