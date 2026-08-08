import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS } from '../fixtures/timeline';

// Recorded session steps 11-14, 19b, 20, 21.

test.describe('banner plan', () => {
  test('shows an empty state pointing at the Balance group', async ({ caratPage }) => {
    await expect(caratPage.planner).toContainText('Start with three quick steps');
    await expect(caratPage.planner).toContainText('Plan assumptions → Balance');
    // The instruction must not point at a location inside the plan any more.
    await expect(caratPage.planner).not.toContainText('carats and tickets above');
  });

  test('keeps starting resources out of the plan entirely', async ({ caratPage }) => {
    await expect(caratPage.planner.getByText('Starting Carats / Tickets')).toHaveCount(0);
    await expect(caratPage.planner.getByRole('spinbutton', { name: 'Free carats' })).toHaveCount(0);

    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    const titles = await caratPage.plannedTitles();
    expect(titles[0]).toContain(FIXTURE_BANNERS.character.title);
  });

  test('adds banners from the timeline dialog', async ({ caratPage }) => {
    await caratPage.addBanners([
      FIXTURE_BANNERS.character.title,
      FIXTURE_BANNERS.support.title,
      FIXTURE_BANNERS.second.title
    ]);

    await expect(caratPage.planRows).toHaveCount(3);
    await expect(caratPage.planner).toContainText(FIXTURE_BANNERS.character.title);
    await expect(caratPage.planner).toContainText(FIXTURE_BANNERS.support.title);
  });

  test('projects cost and total spend from planned pulls', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);

    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');
    // Tickets auto-fill from the pools that accrue before the banner, which
    // would discount the cost by a date-dependent amount. Pin them to zero.
    await caratPage.ticketsInput(FIXTURE_BANNERS.character.title).fill('0');

    // 200 pulls x 150 carats, with no tickets applied.
    await expect(caratPage.planner).toContainText('Cost 30,000');
    await expect(caratPage.summaryStrip).toContainText('30,000');
    await expect(caratPage.summaryStrip).toContainText('200 pulls');
  });

  test('adds a spark with the +200 shortcut', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);

    const pulls = caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title);
    await pulls.fill('200');
    await caratPage.planner.getByRole('button', { name: '+200' }).first().click();

    await expect(pulls).toHaveValue('400');
  });

  test('reorders planned banners by drag', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.second.title]);

    const before = await caratPage.plannedTitles();
    expect(before[0]).toContain(FIXTURE_BANNERS.character.title);

    const handles = caratPage.planner.getByRole('button', { name: 'Reorder banner' });
    const source = handles.nth(1);
    const target = caratPage.planRows.first();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    // dnd-kit needs an activation move plus intermediate steps before the drop.
    const x = sourceBox!.x + sourceBox!.width / 2;
    const fromY = sourceBox!.y + sourceBox!.height / 2;
    const toY = targetBox!.y + 8;

    await caratPage.page.mouse.move(x, fromY);
    await caratPage.page.mouse.down();
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      await caratPage.page.mouse.move(x, fromY + (toY - fromY) * fraction, { steps: 4 });
    }
    await caratPage.page.mouse.up();

    await expect
      .poll(async () => (await caratPage.plannedTitles())[0])
      .toContain(FIXTURE_BANNERS.second.title);
  });

  test('removes a planned banner', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.support.title]);
    await expect(caratPage.planRows).toHaveCount(2);

    await caratPage.removeButton(FIXTURE_BANNERS.character.title).click();

    await expect(caratPage.planRows).toHaveCount(1);
    await expect(caratPage.planner).not.toContainText(FIXTURE_BANNERS.character.title);
  });

  test('persists the plan across a reload and reopens the band collapsed', async ({
    caratPage
  }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');
    await caratPage.setStartingFreeCarats(31_000);

    await caratPage.page.reload();

    await expect(caratPage.planner).toContainText(FIXTURE_BANNERS.character.title);
    await expect(caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title)).toHaveValue('200');
    await expect(caratPage.bandTrigger).toContainText('31,000 starting carats');
    await expect(caratPage.bandTrigger).toHaveAttribute('aria-expanded', 'false');
  });
});
