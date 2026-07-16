// `skillnames` (skill id -> display name) is populated after the data bootstrap
// via `applySkillNameTranslations`, not at module load (the skill service does
// not exist until bootstrap). i18n initializes with an empty map and the names
// are merged in once data is ready.
export default {
  skillnames: {} as Record<string, string>,
  skillfilters: {
    search: 'Search by skill name or conditions',
    // Skills ratities
    white: 'White skills',
    gold: 'Gold skills',
    pink: 'Evolved skills',
    unique: 'Unique skills',
    inherit: 'Inherited uniques',
    // Running Styles
    oonige: 'Runaway',
    nige: 'Front Runner',
    senkou: 'Pace Chaser',
    sasi: 'Late Surger',
    oikomi: 'End Closer',
    // Distances
    short: 'Short',
    mile: 'Mile',
    medium: 'Medium',
    long: 'Long',
    // Surface
    turf: 'Turf',
    dirt: 'Dirt',
    // Phases
    phase0: 'Early-race',
    phase1: 'Mid-race',
    phase2: 'Late-race',
    phase3: 'Last spurt',
    finalcorner: 'Final corner',
    finalstraight: 'Final straight',
    selfdebuff: 'Self-debuff skills'
  },
  skilleffecttypes: {
    // Stats
    '1': 'Speed',
    '2': 'Stamina',
    '3': 'Power',
    '4': 'Guts',
    '5': 'Wisdom',
    '6': 'Change Strategy',

    '8': 'Field of View',
    '9': 'Recovery',

    '10': 'Start Reaction Time',
    '13': 'Rushed Duration',
    '14': 'Start Delay',

    '21': 'Current speed',
    '22': 'Current speed with natural deceleration',
    '27': 'Target speed',
    '28': 'Lane movement speed',
    '29': 'Rushed Chance',
    '31': 'Acceleration',
    '37': 'Activate random gold skill',
    '42': 'Increase skill duration'
  },
  skilldetails: {
    accel: '{{n}}m/s²',
    basinn: '{{n}} bashin',
    conditions: 'Conditions:',
    distance_type: ['', 'Short', 'Mile', 'Medium', 'Long'],
    baseduration: 'Base duration:',
    effectiveduration: 'Effective duration ({{distance}}m):',
    durationincrease: '{{n}}x',
    effects: 'Effects:',
    grade: {
      100: 'G1',
      200: 'G2',
      300: 'G3',
      400: 'OP',
      700: 'Pre-OP',
      800: 'Maiden',
      900: 'Debut',
      999: 'Daily races'
    },
    ground_condition: ['', 'Good', 'Yielding', 'Soft', 'Heavy'],
    ground_type: ['', 'Turf', 'Dirt'],
    id: 'ID: ',
    meters: '{{n}}m',
    motivation: ['', 'Awful', 'Bad', 'Normal', 'Good', 'Great'],
    order_rate: 'CM: {{cm}}, LOH: {{loh}}',
    preconditions: 'Preconditions:',
    show_raw_conditions: 'Show raw conditions',
    show_raw_preconditions: 'Show raw preconditions',
    rotation: ['', 'Clockwise', 'Counterclockwise'],
    running_style: ['', 'Front Runner', 'Pace Chaser', 'Late Surger', 'End Closer'],
    season: ['', 'Early spring', 'Summer', 'Autumn', 'Winter', 'Late spring'],
    seconds: '{{n}}s',
    slope: ['Flat', 'Uphill', 'Downhill'],
    speed: '{{n}}m/s',
    time: ['', 'Morning', 'Mid day', 'Evening', 'Night'],
    weather: ['', 'Sunny', 'Cloudy', 'Rainy', 'Snowy']
  }
};
