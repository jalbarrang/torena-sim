export const CARAT_PER_PULL = 150;

export const TEAM_TRIALS_WEEKLY_CARATS = {
  'class-6': 375,
  'class-5.5': 262,
  'class-5': 225,
  'class-4': 150,
  'class-3': 75,
  'class-2': 35,
  'class-1': 0
} as const;

export const CLUB_RANK_MONTHLY_CARATS = {
  ss: 4500,
  's+': 3600,
  s: 3150,
  'a+': 2700,
  a: 2250,
  'b+': 1800,
  b: 1350,
  'c+': 900,
  c: 450,
  'd+': 225
} as const;

export const CHAMPIONS_MEETING_REWARDS = {
  none: { carats: 0, tickets: 0 },
  champion: { carats: 3300, tickets: 10 },
  second: { carats: 2400, tickets: 8 },
  third: { carats: 1600, tickets: 6 },
  'group-b-1st': { carats: 1800, tickets: 6 },
  'group-b-2nd': { carats: 1250, tickets: 4 },
  'group-b-3rd': { carats: 1000, tickets: 2 },
  'open-league-1st': { carats: 1500, tickets: 6 },
  'open-league-2nd': { carats: 1250, tickets: 4 },
  'open-league-3rd': { carats: 1000, tickets: 2 }
} as const;

export const LEAGUE_OF_HEROES_REWARDS = {
  none: { carats: 0, tickets: 0 },
  'platinum-4': { carats: 3300, tickets: 4 },
  'platinum-3': { carats: 2800, tickets: 4 },
  'platinum-2': { carats: 2300, tickets: 4 },
  'platinum-1': { carats: 1800, tickets: 4 },
  'gold-4': { carats: 1300, tickets: 4 },
  'gold-3': { carats: 1000, tickets: 2 },
  'gold-2': { carats: 700, tickets: 2 },
  'gold-1': { carats: 550, tickets: 0 },
  'silver-4': { carats: 400, tickets: 0 }
} as const;

// The Global timeline payload has no distinct LoH event type; this expected cadence comes from the reference workbook's five events in the 366-day reference window.
export const LEAGUE_OF_HEROES_EXPECTED_EVENTS_PER_MONTH = 5 / 12;

export const DAYS_PER_MONTH = 365.25 / 12;

// The daily pack's 500 paid carats per month are deliberately excluded: only its 50 free carats per day are income.
export const DAILY_CARAT_PACK_FREE_CARATS_PER_DAY = 50;
export const DAILY_CARAT_PACK_AVERAGE_MONTHLY_CARATS =
  DAILY_CARAT_PACK_FREE_CARATS_PER_DAY * DAYS_PER_MONTH;

export const TRAINING_PASS_MATURE_MONTHLY_CARATS = {
  none: 0,
  free: 500,
  paid: 1850
} as const;

export const GLOBAL_TRAINING_PASS_INTRO_MONTHLY_CARATS = {
  none: 0,
  free: 400,
  paid: 1300
} as const;

export const TRAINING_PASS_MONTHLY_TICKETS_PER_TYPE = {
  none: 0,
  free: 2,
  paid: 4
} as const;

export const GLOBAL_TRAINING_PASS_INTRO_START = '2027-08-12T22:00:00.000Z';
export const GLOBAL_TRAINING_PASS_MATURE_START = '2027-12-17T22:00:00.000Z';

export const LOGIN_BONUS_CARATS_PER_50_DAYS = 150;

export const WEEKS_PER_MONTH = 4.345;
