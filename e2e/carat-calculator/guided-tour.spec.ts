import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS } from '../fixtures/timeline';

// Recorded session step 22. The tour is the layout change's most likely silent
// regression: a stale selector renders no highlight rather than throwing.

/** Targets in tour order. `null` is a centered step with no target. */
const TOUR_TARGETS = [
  null,
  'carat-starting-resources',
  'carat-settings',
  'carat-summary',
  'carat-add-banner',
  'carat-pulls-input',
  'carat-odds',
  null
] as const;

test.describe('guided tour', () => {
  test('highlights a real element on every step, including inside the collapsed band', async ({
    caratPage
  }) => {
    // The pulls and odds steps need a planned banner with pulls to point at.
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');

    await caratPage.page.getByRole('button', { name: 'Take a tour' }).click();

    for (const [index, target] of TOUR_TARGETS.entries()) {
      if (target) {
        const element = caratPage.page.locator(`[data-tutorial="${target}"]`).first();
        await expect(
          element,
          `step ${index + 1} targets [data-tutorial="${target}"]`
        ).toBeVisible();
      }

      const isLast = index === TOUR_TARGETS.length - 1;
      const advance = caratPage.page.getByRole('button', {
        name: isLast ? 'Start planning' : 'Next'
      });
      await advance.click();
    }

    await expect(caratPage.page.getByRole('button', { name: 'Start planning' })).toHaveCount(0);
  });

  test('expands the band to reach a target hidden behind the disclosure', async ({ caratPage }) => {
    await expect(caratPage.bandTrigger).toHaveAttribute('aria-expanded', 'false');

    await caratPage.page.getByRole('button', { name: 'Take a tour' }).click();
    await caratPage.page.getByRole('button', { name: 'Next' }).click();

    // Step 2 targets the Balance group, which only exists when the band is open.
    await expect(caratPage.bandTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(caratPage.tab('Balance')).toHaveAttribute('aria-selected', 'true');
    await expect(
      caratPage.page.locator('[data-tutorial="carat-starting-resources"]')
    ).toBeVisible();

    // Step 3 switches to the Income group.
    await caratPage.page.getByRole('button', { name: 'Next' }).click();
    await expect(caratPage.tab('Income')).toHaveAttribute('aria-selected', 'true');

    // Step 4 leaves the band, restoring the layout the user returns to.
    await caratPage.page.getByRole('button', { name: 'Next' }).click();
    await expect(caratPage.bandTrigger).toHaveAttribute('aria-expanded', 'false');
  });
});
