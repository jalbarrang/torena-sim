import { beforeEach, describe, expect, it } from 'vitest';
import {
  reconcileUmaSkillSelectionForPool,
  resetUmaSkillSelectionForRace,
  toggleUmaSkillSelected,
  useUmaSkillSelectionStore
} from './uma-skill-selection.store';

describe('uma skill selection reconciliation', () => {
  beforeEach(() => {
    useUmaSkillSelectionStore.setState({
      selectedSkillIds: new Set(),
      lastActivatableIds: null
    });
  });

  it('resets to all activatable skills and records the pool', () => {
    resetUmaSkillSelectionForRace(['a', 'b']);

    expect(useUmaSkillSelectionStore.getState()).toEqual({
      selectedSkillIds: new Set(['a', 'b']),
      lastActivatableIds: new Set(['a', 'b'])
    });
  });

  it('preserves a manual deselection when the pool shrinks', () => {
    resetUmaSkillSelectionForRace(['a', 'b', 'c']);
    toggleUmaSkillSelected('b');

    reconcileUmaSkillSelectionForPool(['a', 'b']);

    expect(useUmaSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a']));
  });

  it('prunes selected skills that leave the pool', () => {
    resetUmaSkillSelectionForRace(['a', 'b']);

    reconcileUmaSkillSelectionForPool(['a']);

    expect(useUmaSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a']));
    expect(useUmaSkillSelectionStore.getState().lastActivatableIds).toEqual(new Set(['a']));
  });

  it('selects a skill newly entering the pool', () => {
    resetUmaSkillSelectionForRace(['a']);

    reconcileUmaSkillSelectionForPool(['a', 'b']);

    expect(useUmaSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a', 'b']));
  });

  it('selects the full pool when no previous pool exists', () => {
    reconcileUmaSkillSelectionForPool(['a', 'b']);

    expect(useUmaSkillSelectionStore.getState()).toEqual({
      selectedSkillIds: new Set(['a', 'b']),
      lastActivatableIds: new Set(['a', 'b'])
    });
  });
});
