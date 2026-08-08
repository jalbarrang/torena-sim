import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS, FIXTURE_REWARD_EVENT_COUNT } from '../fixtures/timeline';

// Recorded session steps 2-9.

test.describe('plan assumptions band', () => {
  test('opens collapsed and summarizes what it hides', async ({ caratPage }) => {
    await expect(caratPage.bandTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(caratPage.bandTrigger).toContainText('24,500 starting carats');
    await expect(caratPage.bandTrigger).toContainText(/\d+ income sources?/);
    await expect(caratPage.bandTrigger).toContainText(/\d+ reward sources?/);
    await expect(caratPage.page.getByRole('tab')).toHaveCount(0);
  });

  test('expands to the Balance group and shows one group at a time', async ({ caratPage }) => {
    await caratPage.expandBand();

    await expect(caratPage.tab('Balance')).toHaveAttribute('aria-selected', 'true');
    await expect(caratPage.startingResource('Free carats')).toHaveValue('24500');

    await caratPage.tab('Income').click();
    await expect(caratPage.page.getByText('Income & Settings')).toBeVisible();
    await expect(caratPage.startingResource('Free carats')).toHaveCount(0);

    await caratPage.tab('Rewards').click();
    await expect(caratPage.page.locator('[data-tutorial="carat-rewards"]')).toBeVisible();
    await expect(caratPage.page.getByText('Income & Settings')).toHaveCount(0);
  });

  test('collapses back to the summary and drops the groups from the DOM', async ({ caratPage }) => {
    await caratPage.expandBand();
    await caratPage.collapseBand();
    await expect(caratPage.page.getByRole('tab')).toHaveCount(0);
  });

  test('edits starting carats in Balance and reflects them in the collapsed summary', async ({
    caratPage
  }) => {
    await caratPage.setStartingFreeCarats(31_000);
    await caratPage.collapseBand();

    await expect(caratPage.bandTrigger).toContainText('31,000 starting carats');
    await expect(caratPage.summaryStrip).toContainText('31,000');
  });

  test('updates the projection when starting carats change', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');

    await caratPage.setStartingFreeCarats(0);
    await expect(caratPage.verdictBadge('Short')).toBeVisible();

    await caratPage.startingResource('Free carats').fill('500000');
    await expect(caratPage.verdictBadge('Affordable ✓')).toBeVisible();
    await expect(caratPage.verdictBadge('Short')).toHaveCount(0);
  });

  test('hosts the income settings groups in the Income group', async ({ caratPage }) => {
    await caratPage.openGroup('Income');

    const sections = caratPage.page.locator(
      '[data-tutorial="carat-settings"] [data-slot="collapsible-trigger"]'
    );
    await expect(sections).toHaveText([
      'Competitive',
      'Passes & Packs',
      'Recurring Income',
      'What do these terms mean?'
    ]);
  });

  test('lists event and calendar rewards read-only in the Rewards group', async ({ caratPage }) => {
    await caratPage.openGroup('Rewards');

    const rewards = caratPage.page.locator('[data-tutorial="carat-rewards"]');
    await expect(rewards).toContainText('Fixture Story Event');
    await expect(rewards).not.toContainText('Fixture Far Future Event');
    await expect(rewards.locator('input, select, button')).toHaveCount(0);

    // Fixture events inside the window, plus the two annual calendar bonuses.
    const count = await caratPage.rewardsList.count();
    expect(count).toBeGreaterThanOrEqual(FIXTURE_REWARD_EVENT_COUNT);
  });

  test('is operable by keyboard alone', async ({ caratPage }) => {
    await caratPage.bandTrigger.focus();
    await caratPage.page.keyboard.press('Enter');
    await expect(caratPage.tab('Balance')).toBeVisible();

    await caratPage.page.keyboard.press('Tab');
    await expect(caratPage.tab('Balance')).toBeFocused();

    await caratPage.page.keyboard.press('ArrowRight');
    await expect(caratPage.tab('Income')).toBeFocused();

    await caratPage.page.keyboard.press('Enter');
    await expect(caratPage.tab('Income')).toHaveAttribute('aria-selected', 'true');
  });
});
