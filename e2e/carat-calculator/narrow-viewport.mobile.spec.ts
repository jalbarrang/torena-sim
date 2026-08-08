import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS } from '../fixtures/timeline';

// Recorded session step 17. Runs under the chromium-mobile project (Pixel 7).

test.describe('narrow viewport', () => {
  test('keeps the part order and switches the plan to stacked cards', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.support.title]);

    const order = await caratPage.page
      .locator(
        '[data-tutorial="carat-assumptions"], [data-tutorial="carat-summary"], [data-tutorial="carat-planner"]'
      )
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.tutorial));
    expect(order).toEqual(['carat-assumptions', 'carat-summary', 'carat-planner']);

    await expect(caratPage.planner.locator('table')).toHaveCount(0);
    await expect(caratPage.planner.getByRole('button', { name: 'Reorder banner' })).toHaveCount(2);
  });

  test('never scrolls the page horizontally', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.support.title]);

    expect(await caratPage.pageHorizontalOverflow()).toBe(0);
    expect(await caratPage.documentHorizontalOverflow()).toBe(0);
  });

  test('keeps starting resources in the band, not the plan', async ({ caratPage }) => {
    await expect(caratPage.planner.getByText('Starting Carats / Tickets')).toHaveCount(0);

    await caratPage.openGroup('Balance');
    await expect(caratPage.startingResource('Free carats')).toBeVisible();
  });
});
