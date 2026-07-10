export type RaceEventKind =
  | 'skill-activated'
  | 'debuffed'
  | 'rushed'
  | 'rushed-end'
  | 'dueling-start'
  | 'dueling-end'
  | 'spot-struggle-start'
  | 'spot-struggle-end'
  | 'fully-charged'
  | 'fully-charged-end'
  | 'last-spurt'
  | 'hp-out'
  | 'finished'
  | 'pace-down-start'
  | 'pace-down-end'
  | 'pace-up-start'
  | 'pace-up-end'
  | 'pace-up-ex-start'
  | 'pace-up-ex-end'
  | 'overtake-start'
  | 'overtake-end'
  | 'blocked-side-start'
  | 'blocked-side-end'
  | 'mid-race-start'
  | 'late-race-start';

type RaceEventDetail = {
  skillId?: string;
  otherRunnerIds?: number[];
  finishPlace?: number;
  finishTime?: number;
};

export type RaceEvent = {
  kind: RaceEventKind;
  runnerId: number;
  position: number;
  tick: number;
  detail?: RaceEventDetail;
};
