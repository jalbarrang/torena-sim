export const SkillType = {
  Noop: 0,
  // Adds Stat Bonuses
  // - Skills like: Right-Handed, Left-Handed, etc.
  SpeedUp: 1,
  // - Skills like: Standard Distance, Non-Standard Distance, Tokyo Racecourse, etc.
  StaminaUp: 2,
  // - Skills like: Firm Conditions, Soft Conditions, etc.
  PowerUp: 3,
  // - Skills like: Sunny Days, Rainy Days, etc.
  GutsUp: 4,
  // - Skills like: Front Runner Savvy, Pace Chaser Savvy, etc.
  WisdomUp: 5,

  // Skills actionable during the race
  // - Skills that modify the HP of the Runner
  //   Found on Recovery Skills like: "Swinging Maestro" or "Superior Heal"
  //   But Also found on Stamina Drain Skills like: "Stamina Siphon" or "Subdued End Closers"
  Recovery: 9,
  MultiplyStartDelay: 10,

  // - Modifies the starting delay of the Runner
  //   Found on Skills like: "Concentration" or "Focus"
  SetStartDelay: 14,

  // - Increases the Actual Speed of the Runner
  CurrentSpeed: 21,
  CurrentSpeedWithNaturalDeceleration: 22,

  // - Increases the Target Speed of the Runner
  TargetSpeed: 27,

  // - Increases the movement speed of the Runner when they change lanes
  LaneMovementSpeed: 28,

  // - Increases acceleration to reach Top Speed sooner
  //   Found on Skills like: Let's Pump Some Iron!
  Accel: 31,

  // - Skill that triggers when the Runner changes lanes
  ChangeLane: 35,

  // - Summer Goldship's Unique skill enables this
  // ! Note: Summer Goldship's Unique skill is not available at this time.
  ActivateRandomGold: 37,

  // - Some Evolve Skills adds base duration to the skill
  // ! Note: Evolve Skills are not available at this time.
  ExtendEvolvedDuration: 42
} as const;
export type ISkillType = (typeof SkillType)[keyof typeof SkillType];
const SkillEffectName: Record<ISkillType, string> = {
  [SkillType.Noop]: 'Noop',
  [SkillType.SpeedUp]: 'Speed Up',
  [SkillType.StaminaUp]: 'Stamina Up',
  [SkillType.PowerUp]: 'Power Up',
  [SkillType.GutsUp]: 'Guts Up',
  [SkillType.WisdomUp]: 'Wisdom Up',
  [SkillType.Recovery]: 'Recovery',
  [SkillType.MultiplyStartDelay]: 'Multiply Start Delay',
  [SkillType.SetStartDelay]: 'Set Start Delay',
  [SkillType.CurrentSpeed]: 'Current Speed',
  [SkillType.CurrentSpeedWithNaturalDeceleration]: 'Current Speed With Natural Deceleration',
  [SkillType.TargetSpeed]: 'Target Speed',
  [SkillType.LaneMovementSpeed]: 'Lane Movement Speed',
  [SkillType.Accel]: 'Acceleration',
  [SkillType.ChangeLane]: 'Change Lane',
  [SkillType.ActivateRandomGold]: 'Activate Random Gold',
  [SkillType.ExtendEvolvedDuration]: 'Extend Evolved Duration'
};

// Skill Perspective
export const SkillPerspective = {
  Self: 1,
  Other: 2,
  Any: 3
} as const;
export type ISkillPerspective = (typeof SkillPerspective)[keyof typeof SkillPerspective];

// Skill Rarity
export const SkillRarity = {
  White: 1,
  Gold: 2,
  Unique: 3,
  Evolution: 6
} as const;
export type ISkillRarity = (typeof SkillRarity)[keyof typeof SkillRarity];

export const SkillTarget = {
  Self: 1,
  All: 2,
  InFov: 4,
  AheadOfPosition: 7,
  AheadOfSelf: 9,
  BehindSelf: 10,
  AllAllies: 11,
  EnemyStrategy: 18,
  KakariAhead: 19,
  KakariBehind: 20,
  KakariStrategy: 21,
  UmaId: 22,
  UsedRecovery: 23
} as const;
export type ISkillTarget = (typeof SkillTarget)[keyof typeof SkillTarget];
const SkillEffectTargetName: Record<ISkillTarget, string> = {
  [SkillTarget.Self]: 'Self',
  [SkillTarget.All]: 'All',
  [SkillTarget.InFov]: 'In FOV',
  [SkillTarget.AheadOfPosition]: 'Ahead of Position',
  [SkillTarget.AheadOfSelf]: 'Ahead of Self',
  [SkillTarget.BehindSelf]: 'Behind Self',
  [SkillTarget.AllAllies]: 'All Allies',
  [SkillTarget.EnemyStrategy]: 'Enemy Strategy',
  [SkillTarget.KakariAhead]: 'Kakari Ahead',
  [SkillTarget.KakariBehind]: 'Kakari Behind',
  [SkillTarget.KakariStrategy]: 'Kakari Strategy',
  [SkillTarget.UmaId]: 'Uma ID',
  [SkillTarget.UsedRecovery]: 'Used Recovery'
};

export const translateSkillEffectType = (type: ISkillType) => {
  return SkillEffectName[type];
};

export const translateSkillEffectTarget = (target: ISkillTarget) => {
  return SkillEffectTargetName[target];
};
