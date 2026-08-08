## 1. Prepare reusable seams

No user-visible change in this group. Each task ends with `pnpm run typecheck` and `pnpm run test` passing.

- [x] 1.1 Extract the duplicated plan empty state from `banner-plan-table.tsx:172-183` and `:207-216` into a single component under `src/modules/carat/components/`, and render it from both breakpoint branches. Keep the current wording for now.
- [x] 1.2 Confirm `StartingResourcesFields` in `src/modules/carat/components/starting-resources.tsx` renders correctly outside a table cell, and export it. Do not yet remove `StartingResourcesRow` or `StartingResourcesCard`.
- [x] 1.3 Add a selector or helper that reports the event and calendar income sources contributing to the projection, reusing `src/modules/carat/model/event-income.ts`. The Rewards tab consumes this; it introduces no new computation.
- [x] 1.4 Add a selector or helper returning the collapsed-band summary values: starting carat total, count of active income sources, count of reward sources counted.

## 2. Build the assumptions band

- [x] 2.1 Create the band component using `src/components/ui/collapsible.tsx` and `src/components/ui/tabs.tsx`. Check both wrappers' local APIs first — they are Base UI, not Radix, so `asChild` is unavailable and composition uses the repository's `render={...}` pattern.
- [x] 2.2 Implement the collapsed trigger row: title, and the summary from task 1.4. Satisfies spec requirement "Collapsed band summarizes the assumptions it hides".
- [x] 2.3 Implement the **Balance** tab: plan start date plus `StartingResourcesFields` for free carats, paid carats, uma tickets, and support tickets.
- [x] 2.4 Implement the **Income** tab by re-hosting the `Section` groups from `income-settings.tsx` (`Competitive`, `Passes & Packs`, `Recurring Income`) and the glossary disclosure. Content moves; it is not rewritten.
- [x] 2.5 Implement the **Rewards** tab as a read-only list from task 1.3.
- [x] 2.6 Verify the band opens collapsed, shows one tab at a time, and is fully keyboard operable.

## 3. Convert the page to a single column

- [x] 3.1 Replace the `grid lg:grid-cols-[330px_1fr]` planner in `carat-calculator-page.tsx:109` with a flex column. Remove the sidebar slot.
- [x] 3.2 Place the parts in spec order: assumptions band, summary statistics, banner plan.
- [x] 3.3 Apply `min-w-0` to the container wrapping the plan, and confirm the existing `overflow-x-auto` on `banner-plan-table.tsx:117` now takes effect. This is the structural fix from design Decision 1.
- [x] 3.4 Remove `lg:overflow-hidden` from the page container and the inner panel's own scrolling, so the document is the scroll container. Deviation: the app shell (`src/routes/root.tsx:82-85`) is `h-dvh` with an `overflow-hidden` `main`, so the document itself can never scroll. The page container keeps its `overflow-y-auto` and is the single vertical scroll container; the inner panel's own scrolling is gone, which is what Decision 9 relies on.
- [x] 3.5 Delete the now-unused sidebar shell from `income-settings.tsx`, keeping only the section content consumed by task 2.4.

## 4. Remove starting resources from the plan

- [x] 4.1 Remove `StartingResourcesRow` and its call site at `banner-plan-table.tsx:155`.
- [x] 4.2 Remove `StartingResourcesCard` and its call site at `banner-plan-table.tsx:191`.
- [x] 4.3 Revisit the table's column minimum widths now that the widest row is gone, and reduce any floor that only existed to accommodate it. Reviewed: the `min-w-56` ×2, `min-w-64`, and `w-44 min-w-44` floors on the carats-available and odds columns existed only on the starting row and left with it. Every remaining floor (`w-10`, `min-w-[220px]`, `w-44 min-w-44` on pulls/tickets, `w-32`) is declared by `sortable-plan-row.tsx` for planned banners, so none was reduced.
- [x] 4.4 Update the empty state from task 1.1: it must direct users to the Balance group of the assumptions band, not to a location "above" within the plan.

## 5. Compact the summary statistics

- [x] 5.1 Replace the card grid in `src/modules/carat/components/summary-stats.tsx` with a single horizontal strip. Reuse the existing computation and the income breakdown popover unchanged.
- [x] 5.2 Confirm the strip wraps rather than clips or truncates at 360 pixels.

## 6. Restore the guided tour

- [x] 6.1 Add optional `onBeforeStep?: () => void` to `TutorialStep` in `src/components/tutorial/types.ts`, and invoke it in the step runner before the target selector is resolved. Additive and optional — existing steps must be unaffected.
- [x] 6.2 Re-point every `data-tutorial` anchor in `src/modules/tutorial/steps/carat-calculator-steps.ts` that moved, including `carat-starting-resources` and `carat-planner`.
- [x] 6.3 Use `onBeforeStep` on steps targeting band content to expand the band and select the containing tab.
- [x] 6.4 Re-order the tour so the Balance group is visited early, preserving the onboarding path that the removed numbered row used to carry.

## 7. Tests

- [x] 7.1 Update `src/modules/carat/components/banner-plan-lifecycle.test.tsx` for the new structure.
- [x] 7.2 Add a test asserting the structural overflow contract: the plan container carries `min-w-0` and its inner wrapper carries `overflow-x-auto`. This is the CI-side guard from design Decision 7.
- [x] 7.3 Add tests for the band: opens collapsed, summary reflects current values, summary updates after an edit, one tab shown at a time.
- [x] 7.4 Add a test that starting-resource edits in the Balance group update the projection.
- [x] 7.5 Add a test asserting no starting-resources entry appears in the plan.

## 8. Verification gates

Manual checks. These cover the spec scenarios that jsdom cannot assert; see design Decision 7.

- [x] 8.1 Measure `scrollWidth <= clientWidth` on the page container at 360, 768, 1024, and 1440 pixels with at least two planned banners.
- [x] 8.2 Confirm the odds and result information is fully visible at 1440 pixels without horizontal scrolling.
- [x] 8.3 Run the guided tour end to end and confirm every step highlights a real element, including steps that expand the band.
- [x] 8.4 Verify drag-to-reorder at both breakpoints with a plan taller than the viewport, including a drag toward the viewport edge that requires auto-scroll. This is the risk flagged in design Decision 9.
- [x] 8.5 Load a plan saved before the change and confirm settings, planned banners, and results are unchanged. Import a share code generated before the change and confirm it round-trips.
- [x] 8.6 Run `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, and `pnpm run intent`.
