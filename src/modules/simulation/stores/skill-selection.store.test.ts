import { beforeEach, describe, expect, it } from 'vitest';
import {
  reconcileSkillSelectionForPool,
  resetSkillSelectionForRace,
  toggleSkillSelected,
  useSkillSelectionStore
} from './skill-selection.store';

describe('skill selection reconciliation', () => {
  beforeEach(() => {
    useSkillSelectionStore.setState({
      selectedSkillIds: new Set(),
      lastActivatableIds: null,
      initialized: false
    });
  });

  it('resets to all activatable skills and records the pool', () => {
    resetSkillSelectionForRace(['a', 'b']);

    expect(useSkillSelectionStore.getState()).toMatchObject({
      selectedSkillIds: new Set(['a', 'b']),
      lastActivatableIds: new Set(['a', 'b']),
      initialized: true
    });
  });

  it('preserves a manual deselection when the pool shrinks', () => {
    resetSkillSelectionForRace(['a', 'b', 'c']);
    toggleSkillSelected('b');

    reconcileSkillSelectionForPool(['a', 'b']);

    expect(useSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a']));
  });

  it('prunes selected skills that leave the pool', () => {
    resetSkillSelectionForRace(['a', 'b']);

    reconcileSkillSelectionForPool(['a']);

    expect(useSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a']));
    expect(useSkillSelectionStore.getState().lastActivatableIds).toEqual(new Set(['a']));
  });

  it('selects a skill newly entering the pool', () => {
    resetSkillSelectionForRace(['a']);

    reconcileSkillSelectionForPool(['a', 'b']);

    expect(useSkillSelectionStore.getState().selectedSkillIds).toEqual(new Set(['a', 'b']));
  });

  it('selects the full pool when no previous pool exists', () => {
    reconcileSkillSelectionForPool(['a', 'b']);

    expect(useSkillSelectionStore.getState()).toMatchObject({
      selectedSkillIds: new Set(['a', 'b']),
      lastActivatableIds: new Set(['a', 'b']),
      initialized: true
    });
  });
});
