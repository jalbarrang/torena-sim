## Why

The Carat Calculator at `/carat-calculator` renders its planner as a two-column grid: a fixed 330 pixel settings sidebar beside the banner plan table. The table's minimum content width exceeds the space the sidebar leaves it, so the page scrolls horizontally and the rightmost column is clipped. That column is `Odds / result`, which holds the probability estimates the tool exists to produce.

Measured in the running development app at a 1440 pixel viewport with two planned banners:

| Element | Available width | Required width | Overflow |
| --- | --- | --- | --- |
| Page container (`src/modules/carat/components/carat-calculator-page.tsx:57`) | 1440 px | 1582 px | 142 px |
| Planner grid (`carat-calculator-page.tsx:109`) | 1408 px | 1566 px | 158 px |
| Plan table wrapper (`banner-plan-table.tsx:117`) | 1184 px | 1184 px | forced to content |

There are two distinct defects. First, the grid template `lg:grid-cols-[330px_1fr]` uses a bare `1fr` track, whose automatic minimum size cannot shrink below its content. The `overflow-x-auto` wrapper on the table therefore never activates, and the table pushes the whole page sideways instead of scrolling inside its own container. The same file already applies the correct pattern to rows (`lg:grid-rows-[minmax(0,1fr)]`).

Second, even after that is corrected, the sidebar leaves the table only 1026 pixels against a 1184 pixel minimum. The odds column becomes reachable only by horizontal scrolling inside the table. Removing the sidebar raises the available width to 1372 pixels, at which point the table fits without scrolling at all.

| Layout | Table wrapper width | Table minimum width | Result |
| --- | --- | --- | --- |
| Today | 1184 px | 1184 px | page scrolls horizontally, odds column clipped |
| `minmax(0,1fr)` only | 1026 px | 1184 px | page fixed, table scrolls internally by 158 px |
| Single column | 1372 px | 1184 px | fits with 188 px spare |

The reference implementation at `https://uma.moe/timeline?tab=carat-planner` solves this by placing settings in a collapsible full-width band above the plan rather than in a persistent sidebar. This change adopts that information architecture.

## What Changes

- Replace the two-column planner grid in `carat-calculator-page.tsx` with a single-column layout. The plan table spans the full content width at every breakpoint.
- Introduce a collapsible "Plan assumptions" band above the plan, containing three tabs: **Balance**, **Income**, and **Rewards**. The band is collapsed by default and shows a summary of its contents in the collapsed header, so the values that drive the projection remain visible without expanding.
- Move the settings currently in `src/modules/carat/components/income-settings.tsx` into the Income tab. Its existing `Section` groups (`Competitive`, `Passes & Packs`, `Recurring Income`) and the glossary disclosure are preserved as content within that tab.
- **BREAKING (user-visible):** Move starting carats and tickets out of the plan table and into the Balance tab. `StartingResourcesRow` and `StartingResourcesCard` in `src/modules/carat/components/starting-resources.tsx` are removed as table/card members, and their shared `StartingResourcesFields` is reused in the new tab. The plan table's first row becomes the first planned banner. This removes the row whose `min-w` declarations contribute roughly 700 pixels to the table's minimum width.
- Add a **Rewards** tab surfacing event and calendar income, which is currently computed in `src/modules/carat/model/event-income.ts` and shown only as part of the aggregated monthly income figure. This makes the third tab meaningful rather than a structural copy of the reference site.
- Replace the five summary cards rendered by `src/modules/carat/components/summary-stats.tsx` with a compact inline statistic strip, freeing the vertical band the cards currently occupy.
- Correct the grid track to `minmax(0,1fr)` wherever a flexible track contains the plan table, so that no layout state can push the page into horizontal scroll again.
- Apply the same single-column structure to the narrow-viewport path. The card layout in `banner-plan-table.tsx` keeps its stacked presentation, and the Plan assumptions band collapses to a full-width accordion with the same three tabs.

## Capabilities

### New Capabilities

- `carat-planner-layout` — the layout and information architecture of the Carat Calculator page: how planner settings, summary statistics, and the banner plan are arranged; the responsive behavior across breakpoints; and the requirement that the page never scrolls horizontally.

### Modified Capabilities

None. No existing capability specs are present under `openspec/specs/`.

## Impact

### Affected code

| Path | Change |
| --- | --- |
| `src/modules/carat/components/carat-calculator-page.tsx` | Page shell rewritten from two-column grid to single column; hosts the new assumptions band |
| `src/modules/carat/components/income-settings.tsx` | Sidebar container removed; section content re-hosted inside the Income tab |
| `src/modules/carat/components/starting-resources.tsx` | `StartingResourcesRow` and `StartingResourcesCard` removed; `StartingResourcesFields` retained and reused |
| `src/modules/carat/components/banner-plan-table.tsx` | Starting-resources row and card removed from both branches; column minimum widths revisited |
| `src/modules/carat/components/summary-stats.tsx` | Card grid replaced with an inline statistic strip |
| `src/modules/carat/components/use-wide-viewport.ts` | Reviewed against the new breakpoint behavior; may be unchanged |
| New component(s) under `src/modules/carat/components/` | Plan assumptions band and its tab panels |

### Not affected

- `src/store/carat.store.ts` and the persisted plan shape. This change is presentational; no stored settings are added, removed, or renamed, so existing saved plans and share codes continue to load.
- The model layer under `src/modules/carat/model/`. Projection, odds, and income calculations are unchanged.
- `src/routes/_tools/carat-calculator.tsx`, which only mounts the page component.

### Dependent surfaces

- The guided tour in `src/modules/tutorial/steps/carat-calculator-steps.ts` targets elements by `data-tutorial` attribute, including `carat-starting-resources` and `carat-planner`. Those anchors move with the elements and the tour steps must be re-pointed and re-verified.
- Existing tests under `src/modules/carat/components/banner-plan-lifecycle.test.tsx` query the current structure and will need updating.

## Non-Goals

- Replacing the "Add banner from timeline" dialog (`src/modules/carat/components/add-banner-dialog.tsx`) with an inline search field. The reference site adds banners through inline search; adopting that changes the timeline data flow, not the layout, and is deferred to a separate change.
- Editable plan names or changes to `src/modules/carat/components/plan-switcher.tsx`.
- Visual restyling beyond what the layout change requires. Colors, typography, and component styling follow the existing design system.

## Risks

- **Settings become less discoverable.** A collapsed band hides income settings that a sidebar kept permanently visible. The summary in the collapsed header is the mitigation and must convey enough to explain an unexpected projection without expanding the band.
- **Reading order changes.** Starting carats currently read as step 1 of the plan, reinforced by a numbered badge and the empty-state instruction "Set your available carats and tickets above" (`banner-plan-table.tsx:174`). Moving them into a collapsed band weakens that onboarding path, and the empty state text must be revised to match.
- **Drag-and-drop regression.** The plan uses `@dnd-kit` sortable contexts in both the table and card branches. Changing the scroll container from an inner panel to the page affects auto-scroll behavior during a drag and requires explicit verification.
- **Tour breakage.** The guided tour is the most likely silent regression, because a stale `data-tutorial` selector fails at runtime rather than at build time.

## Validation

- `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, and `pnpm run intent`.
- A regression test asserting that the page container's `scrollWidth` does not exceed its `clientWidth` at representative viewport widths, so the horizontal-overflow defect cannot recur.
- Manual verification of the guided tour end to end, and of drag-to-reorder at both wide and narrow viewports.
