import { describe, expect, it } from 'vitest';
import { sanitizePostHogEvent } from './posthog-event-sanitizer';

describe('sanitizePostHogEvent', () => {
  it('removes query strings and fragments from captured URLs', () => {
    const event = sanitizePostHogEvent({
      uuid: 'event-id',
      event: '$exception',
      properties: {
        $current_url: 'https://torena-sim.pages.dev/race-sim?rooster=secret#results',
        $session_entry_url: 'https://torena-sim.pages.dev/skill-planner?planner=secret',
        app_route: '/race-sim'
      }
    });

    expect(event?.properties).toMatchObject({
      $current_url: 'https://torena-sim.pages.dev/race-sim',
      $session_entry_url: 'https://torena-sim.pages.dev/skill-planner',
      app_route: '/race-sim'
    });
  });

  it('passes null events through', () => {
    expect(sanitizePostHogEvent(null)).toBeNull();
  });
});
