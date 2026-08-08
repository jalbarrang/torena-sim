import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS } from '../fixtures/timeline';

// Recorded session steps 10, 23, 24.

test.describe('plan management', () => {
  test('opens the monthly income breakdown popover', async ({ caratPage }) => {
    await caratPage.page.getByRole('button', { name: 'Show monthly income breakdown' }).click();

    const popover = caratPage.page.getByRole('dialog').last();
    await expect(popover).toContainText('Monthly income breakdown');
    await expect(popover).toContainText('Recurring rewards');
    await expect(popover).toContainText('Champions Meeting');
    await expect(popover).toContainText('League of Heroes');
    await expect(popover).toContainText('Events & calendar');
    await expect(popover).toContainText('Total');
  });

  test('creates a new plan that starts from the defaults', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    await caratPage.setStartingFreeCarats(31_000);
    await caratPage.collapseBand();

    await caratPage.page.getByRole('button', { name: 'New plan' }).click();
    await caratPage.page.getByRole('textbox', { name: 'Plan name' }).fill('E2E plan');
    await caratPage.page.getByRole('button', { name: 'Create' }).click();

    await expect(caratPage.page.getByRole('combobox')).toContainText('E2E plan');
    await expect(caratPage.bandTrigger).toContainText('24,500 starting carats');
    await expect(caratPage.planner).toContainText('Start with three quick steps');
  });

  test('round-trips a plan through a share code', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.support.title]);
    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');
    await caratPage.setStartingFreeCarats(31_000);
    await caratPage.collapseBand();

    const result = await caratPage.page.evaluate(async () => {
      const snapshot = await import('/src/modules/carat/share/snapshot.ts');
      const codec = await import('/src/modules/carat/share/share-code.ts');
      const before = snapshot.buildCaratPlanSnapshot();
      const code = await codec.encodeCaratPlanShareCode(before);
      const after = await codec.decodeCaratPlanShareCode(code);
      return {
        prefix: code.slice(0, 4),
        roundTrips: JSON.stringify(before) === JSON.stringify(after)
      };
    });

    expect(result.prefix).toBe('cp2:');
    expect(result.roundTrips).toBe(true);
  });
});
