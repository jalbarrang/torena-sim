import type { SkillEffectLog } from '@/modules/simulation/compare.types';

export type CollectedRunnerRoundData = {
  runnerId: number;
  time: number[];
  position: number[];
  velocity: number[];
  hp: number[];
  currentLane: number[];
  pacerGap: number[];
  /** Per-tick race order (1-based rank; 0 when the engine does not track it). */
  order: number[];
  skillActivations: Record<string, SkillEffectLog[]>;
  targetedSkillActivations: Record<string, SkillEffectLog[]>;
  startDelay: number;
  rushed: Array<[number, number]>;
  duelingRegion: [number, number] | [];
  spotStruggleRegion: [number, number] | [];
  fullyChargedRegion: [number, number] | [];
  fullyChargedAccel: number | null;
  hasAchievedFullSpurt: boolean;
  outOfHp: boolean;
  outOfHpPosition: number | null;
  nonFullSpurtVelocityDiff: number | null;
  nonFullSpurtDelayDistance: number | null;
  firstPositionInLateRace: boolean;
  usedSkills: string[];
  finished: boolean;
  finishPosition: number;
};
