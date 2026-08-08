import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { buildTimelineFixture } from './timeline';

export const CARAT_CALCULATOR_PATH = '/carat-calculator';

/** Page object for the Carat Calculator, mirroring the recorded agent-browser session. */
export class CaratCalculatorPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // --- Regions -------------------------------------------------------------

  get assumptionsBand(): Locator {
    return this.page.locator('[data-tutorial="carat-assumptions"]');
  }

  get summaryStrip(): Locator {
    return this.page.locator('[data-tutorial="carat-summary"]');
  }

  get planner(): Locator {
    return this.page.locator('[data-tutorial="carat-planner"]');
  }

  get planScroller(): Locator {
    return this.planner.locator('.overflow-x-auto');
  }

  get planRows(): Locator {
    return this.planner.locator('tbody tr');
  }

  get planCards(): Locator {
    return this.planner.locator('article');
  }

  // --- Assumptions band ----------------------------------------------------

  get bandTrigger(): Locator {
    return this.page.getByRole('button', { name: /Plan assumptions/ });
  }

  tab(name: 'Balance' | 'Income' | 'Rewards'): Locator {
    return this.page.getByRole('tab', { name });
  }

  startingResource(
    label: 'Free carats' | 'Paid carats' | 'Uma tickets' | 'Support tickets'
  ): Locator {
    return this.page.getByRole('spinbutton', { name: label });
  }

  get rewardsList(): Locator {
    return this.page.locator('[data-tutorial="carat-rewards"] li');
  }

  async expandBand() {
    if ((await this.bandTrigger.getAttribute('aria-expanded')) === 'false') {
      await this.bandTrigger.click();
    }
    await expect(this.tab('Balance')).toBeVisible();
  }

  async collapseBand() {
    if ((await this.bandTrigger.getAttribute('aria-expanded')) === 'true') {
      await this.bandTrigger.click();
    }
    await expect(this.bandTrigger).toHaveAttribute('aria-expanded', 'false');
  }

  async openGroup(name: 'Balance' | 'Income' | 'Rewards') {
    await this.expandBand();
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
  }

  async setStartingFreeCarats(value: number) {
    await this.openGroup('Balance');
    await this.startingResource('Free carats').fill(String(value));
  }

  // --- Plan ----------------------------------------------------------------

  get addBannerButton(): Locator {
    return this.page.getByRole('button', { name: '+ Add banner from timeline' });
  }

  plannedPullsInput(bannerTitle: string): Locator {
    return this.page.getByRole('spinbutton', { name: `Planned pulls for ${bannerTitle}` });
  }

  /** Tickets auto-fill from the accruing pools, so pin them to make cost deterministic. */
  ticketsInput(bannerTitle: string): Locator {
    return this.page.getByRole('spinbutton', {
      name: new RegExp(`tickets to use on ${bannerTitle}`)
    });
  }

  /** The affordability badge, distinct from the "short by …" explanation below it. */
  verdictBadge(verdict: 'Short' | 'Affordable ✓'): Locator {
    return this.summaryStrip.getByText(verdict, { exact: true });
  }

  removeButton(bannerTitle: string): Locator {
    return this.page.getByRole('button', { name: `Remove ${bannerTitle}` });
  }

  async addBanners(titles: string[]) {
    await this.addBannerButton.click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    for (const title of titles) {
      await dialog.getByRole('option', { name: new RegExp(title) }).click();
    }

    await this.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }

  /** Titles of the planned banners, in the order the plan renders them. */
  async plannedTitles(): Promise<string[]> {
    return this.planner
      .locator('tbody tr th, article h3')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? '').split('\n', 1)[0].trim().slice(0, 40))
      );
  }

  // --- Measurements --------------------------------------------------------

  /** Horizontal overflow of the page's scroll container, in pixels. */
  async pageHorizontalOverflow(): Promise<number> {
    return this.planner.evaluate((element) => {
      const container = element.closest('.overflow-y-auto');
      if (!container) throw new Error('page scroll container not found');
      return container.scrollWidth - container.clientWidth;
    });
  }

  async documentHorizontalOverflow(): Promise<number> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
  }

  // --- Setup ---------------------------------------------------------------

  async goto() {
    await this.page.goto(CARAT_CALCULATOR_PATH);
    await expect(this.page.getByRole('heading', { name: 'Pull Planner', level: 1 })).toBeVisible();
    await expect(this.assumptionsBand).toBeVisible();
  }
}

type CaratFixtures = {
  caratPage: CaratCalculatorPage;
};

/**
 * Every test gets a stubbed timeline, so runs do not inherit the live schedule.
 * Storage needs no explicit reset: each test runs in a fresh browser context,
 * and the persistence spec relies on that (an init script would wipe the store
 * on reload).
 */
export const test = base.extend<CaratFixtures>({
  // The second parameter is Playwright's `use` callback. It is named `runTest`
  // here because `use` trips the React rules-of-hooks lint rule.
  caratPage: async ({ page }, runTest) => {
    await page.route('**/timeline', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(buildTimelineFixture())
      });
    });

    const caratPage = new CaratCalculatorPage(page);
    await caratPage.goto();
    await runTest(caratPage);
  }
});

export { expect } from '@playwright/test';
