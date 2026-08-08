import { expect, test } from '../fixtures/carat-calculator';
import { FIXTURE_BANNERS } from '../fixtures/timeline';

// Recorded session steps 1, 15, 16, 17, 18.
// Spec: openspec/changes/redesign-carat-planner-layout/specs/carat-planner-layout/spec.md

const SUPPORTED_WIDTHS = [360, 768, 1024, 1440];

test.describe('carat calculator layout', () => {
  test('renders assumptions band, statistics strip, then banner plan', async ({ caratPage }) => {
    const order = await caratPage.page
      .locator(
        '[data-tutorial="carat-assumptions"], [data-tutorial="carat-summary"], [data-tutorial="carat-planner"]'
      )
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.tutorial));

    expect(order).toEqual(['carat-assumptions', 'carat-summary', 'carat-planner']);
  });

  test('never scrolls the page horizontally at any supported width', async ({ caratPage }) => {
    await caratPage.addBanners([FIXTURE_BANNERS.character.title, FIXTURE_BANNERS.support.title]);

    for (const width of SUPPORTED_WIDTHS) {
      await caratPage.page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => caratPage.pageHorizontalOverflow(), {
          message: `page scrolls horizontally at ${width}px`
        })
        .toBe(0);
      expect(await caratPage.documentHorizontalOverflow()).toBe(0);
    }
  });

  test('gives the plan a container that can shrink below its content', async ({ caratPage }) => {
    // The structural contract behind the overflow fix: a flexible container
    // with a zero minimum width, wrapping one that scrolls on its own.
    await expect(caratPage.planner).toHaveClass(/min-w-0/);
    await expect(caratPage.planScroller).toHaveCount(1);
  });

  test('shows the odds column without horizontal scrolling at 1440px', async ({ caratPage }) => {
    await caratPage.page.setViewportSize({ width: 1440, height: 900 });
    await caratPage.addBanners([FIXTURE_BANNERS.character.title]);
    await caratPage.plannedPullsInput(FIXTURE_BANNERS.character.title).fill('200');

    const oddsHeader = caratPage.planner.getByRole('columnheader', { name: /Odds \/ result/ });
    await expect(oddsHeader).toBeVisible();

    const box = await oddsHeader.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);

    await expect(caratPage.planner.locator('[data-tutorial="carat-odds"]').first()).toBeVisible();
    expect(await caratPage.planScroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });

  test('wraps the statistics strip at 360px without clipping any figure', async ({ caratPage }) => {
    await caratPage.page.setViewportSize({ width: 360, height: 900 });

    const labels = await caratPage.summaryStrip
      .locator('.text-xs.font-bold')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent));
    expect(labels).toEqual([
      'Balance at last banner',
      'Current Carats',
      'Starting Tickets',
      'Monthly Income',
      'Total Spend'
    ]);

    const measured = await caratPage.summaryStrip.evaluate((strip) => ({
      lines: new Set(
        [...strip.children].map((child) => Math.round(child.getBoundingClientRect().top))
      ).size,
      clipped: [...strip.querySelectorAll('*')].filter(
        (element) => element.scrollWidth > element.clientWidth + 1
      ).length,
      overflowX: strip.scrollWidth - strip.clientWidth
    }));

    expect(measured.lines).toBeGreaterThan(1);
    expect(measured.clipped).toBe(0);
    expect(measured.overflowX).toBe(0);
  });
});
