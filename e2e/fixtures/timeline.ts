/**
 * A small, deterministic stand-in for the timeline Worker payload.
 *
 * The live Worker serves ~1000 events whose dates move as the game schedule
 * moves, which would make assertions about counts, titles, and affordability
 * drift. Dates here are computed relative to the moment the fixture is built,
 * so planned banners are always upcoming and the projection window always
 * contains the same reward events.
 */

const DAY = 24 * 60 * 60 * 1000;

function iso(base: number, days: number) {
  return new Date(base + days * DAY).toISOString();
}

export type TimelineFixtureOptions = {
  /** Epoch millis the fixture is anchored to. Defaults to now. */
  now?: number;
};

export const FIXTURE_BANNERS = {
  character: { id: 'e2e-character-banner', title: 'Fixture Character Banner' },
  support: { id: 'e2e-support-banner', title: 'Fixture Support Banner' },
  second: { id: 'e2e-second-banner', title: 'Fixture Second Banner' }
} as const;

/** Story/campaign/legend events inside the 365-day projection window. */
export const FIXTURE_REWARD_EVENT_COUNT = 4;

export function buildTimelineFixture(options: TimelineFixtureOptions = {}) {
  const base = options.now ?? Date.now();

  return {
    version: 'e2e-fixture',
    anniversaries: [],
    calculation: {},
    events: [
      {
        id: FIXTURE_BANNERS.character.id,
        type: 'character_banner',
        card_type: 'character',
        source: 'character',
        title: FIXTURE_BANNERS.character.title,
        global_release_date: iso(base, 14),
        estimated_end_date: iso(base, 24),
        banner_duration_days: 10,
        is_confirmed: true,
        prediction: { kind: 'confirmed' },
        planner_data_available: true,
        pickup_card_ids: [100101],
        related_characters: ['Special Week'],
        tags: ['character-banner']
      },
      {
        id: FIXTURE_BANNERS.support.id,
        type: 'support_card_banner',
        card_type: 'support',
        source: 'support',
        title: FIXTURE_BANNERS.support.title,
        global_release_date: iso(base, 21),
        estimated_end_date: iso(base, 31),
        banner_duration_days: 10,
        is_confirmed: true,
        prediction: { kind: 'confirmed' },
        planner_data_available: true,
        pickup_card_ids: [30001],
        tags: ['support-banner']
      },
      {
        id: FIXTURE_BANNERS.second.id,
        type: 'character_banner',
        card_type: 'character',
        source: 'character',
        title: FIXTURE_BANNERS.second.title,
        global_release_date: iso(base, 45),
        estimated_end_date: iso(base, 55),
        banner_duration_days: 10,
        is_confirmed: true,
        prediction: { kind: 'confirmed' },
        planner_data_available: true,
        pickup_card_ids: [100201],
        related_characters: ['Silence Suzuka'],
        tags: ['character-banner']
      },
      // Reward sources counted into the projection (Rewards group).
      {
        id: 'e2e-story-event-1',
        type: 'story_event',
        title: 'Fixture Story Event',
        global_release_date: iso(base, 10),
        estimated_end_date: iso(base, 22),
        banner_duration_days: 12
      },
      {
        id: 'e2e-story-event-2',
        type: 'story_event',
        title: 'Fixture Story Event Two',
        global_release_date: iso(base, 100),
        estimated_end_date: iso(base, 112),
        banner_duration_days: 12
      },
      {
        id: 'e2e-campaign-1',
        type: 'campaign',
        title: 'Fixture Campaign',
        global_release_date: iso(base, 30),
        estimated_end_date: iso(base, 40),
        banner_duration_days: 10
      },
      {
        id: 'e2e-legend-race-1',
        type: 'legend_race',
        title: 'Fixture Legend Race',
        global_release_date: iso(base, 60),
        estimated_end_date: iso(base, 65),
        banner_duration_days: 5
      },
      // Outside the 365-day window: must not appear in the Rewards list.
      {
        id: 'e2e-story-event-far',
        type: 'story_event',
        title: 'Fixture Far Future Event',
        global_release_date: iso(base, 800),
        estimated_end_date: iso(base, 812),
        banner_duration_days: 12
      }
    ]
  };
}
