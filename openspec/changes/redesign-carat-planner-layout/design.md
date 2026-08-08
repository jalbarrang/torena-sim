## Context

See `proposal.md` — Why for the motivation and the measurements.

Constraints that shape the approach:

- The page is a client-rendered React 19 SPA. All layout is Tailwind CSS utility classes; there is no CSS-in-JS or stylesheet module for this page.
- The repository already provides the primitives this change needs: `src/components/ui/collapsible.tsx` and `src/components/ui/tabs.tsx`, both Base UI based. No new dependency is required.
- Vitest runs component tests in jsdom, selected per file with a `// @vitest-environment jsdom` docblock. There is no browser-based test runner and no Playwright configuration in the repository.
- The guided tour resolves each step's target with a CSS selector at the time the step is shown (`src/components/tutorial/types.ts`, `TutorialStep.element`). A step whose target is not in the document renders without a highlight; the failure is silent.
- Plan state lives in `src/store/carat.store.ts` and is persisted. This change treats it as read-only.

## Goals / Non-Goals

**Goals:**

- Remove the page-level horizontal overflow structurally, so that no future content width can reintroduce it.
- Give the banner plan the full content width at every breakpoint.
- Keep one component tree across breakpoints, varying only presentation, so the two branches cannot diverge in behavior.
- Leave the persisted plan shape and the model layer untouched.

**Non-Goals:**

- Introducing a browser-based test runner. See Decision 7.
- Persisting the assumptions band's open state. See Decision 3.
- Changing how income, odds, or projections are computed.

## Decisions

### 1. Replace the planner grid with a flex column, and give the plan container an explicit minimum width of zero

`src/modules/carat/components/carat-calculator-page.tsx:109` currently uses `grid lg:grid-cols-[330px_1fr]`. The bare `1fr` track has an automatic minimum size equal to its content, which is why the `overflow-x-auto` wrapper inside `banner-plan-table.tsx:117` never activates.

The planner becomes a single flex column. The container that wraps the plan carries `min-w-0`, which is the flex-context equivalent of `minmax(0,1fr)` and produces the same result: the plan can be narrower than its content, so its own overflow container takes effect.

**Alternative considered:** keep the two-column grid and change the track to `minmax(0,1fr)`. This is a one-line fix and does remove the page overflow, but it leaves the table 1026 pixels against a 1184 pixel minimum, so the odds column stays behind an internal scrollbar. It resolves the symptom in `proposal.md` without satisfying the requirement that odds be visible without scrolling.

**Alternative considered:** keep the grid and use `lg:grid-cols-[330px_minmax(0,1fr)]` with a narrower sidebar. Any sidebar wide enough to hold the existing settings leaves the table short of 1184 pixels. The arithmetic does not work.

### 2. Build the assumptions band from the existing Collapsible and Tabs primitives

The band is a `Collapsible` whose trigger row holds the title and the collapsed summary, and whose content holds a `Tabs` with three panels. Both primitives already exist and are Base UI based, so keyboard interaction, focus management, and ARIA wiring come from the primitive rather than from new code.

Per `AGENTS.md`, these are Base UI wrappers, not Radix: `asChild` is not available, and composition uses the repository's `render={...}` pattern. Check each wrapper's local API before use.

**Alternative considered:** a bespoke disclosure built from a `button` and conditional rendering, matching the ad-hoc `Section` component inside `income-settings.tsx`. Rejected — it would be a third disclosure implementation in the same module and would need its own accessibility work.

### 3. The band's open state is component state and is not persisted

The band opens collapsed on every page load. The open state lives in the band component and is not written to any store.

Rationale: persisting it requires either extending the persisted plan shape, which the proposal explicitly rules out, or introducing a separate UI-preferences store, which is a larger change than this one needs. The collapsed summary required by the spec is what makes a collapsed default acceptable — a user can read the assumptions without expanding.

**Trade-off:** a user who edits income settings repeatedly re-expands the band each visit. If that proves annoying in practice, adding persistence later is additive and does not change the specs.

**Alternative considered:** default the band to expanded. Rejected — it reintroduces a tall settings band above the plan, which is most of what the current sidebar costs, only on the vertical axis.

### 4. `StartingResourcesFields` is the reuse seam; the row and card wrappers are deleted

`src/modules/carat/components/starting-resources.tsx` already separates the field grid (`StartingResourcesFields`) from its two presentation wrappers (`StartingResourcesRow`, `StartingResourcesCard`). Only the wrappers are layout-specific. The Balance tab renders `StartingResourcesFields` directly alongside the plan start date; both wrappers and their call sites in `banner-plan-table.tsx:155` and `banner-plan-table.tsx:191` are removed.

This is also the largest single contributor to the table's minimum width. `StartingResourcesRow` declares `min-w-[220px]`, two `min-w-56`, `w-44`, `min-w-64`, and `w-32` across its cells — roughly 700 pixels of floor that the planned-banner rows do not all require. Removing it lets the remaining column widths be set by the banner rows alone.

### 5. The Rewards tab presents existing computed income read-only

Event and calendar income is already computed in `src/modules/carat/model/event-income.ts` and surfaced only as part of the aggregated monthly figure, via the breakdown popover in `summary-stats.tsx`. The Rewards tab reuses that computation and lists the contributing sources. It does not introduce editable reward settings.

**Alternative considered:** make rewards individually toggleable, as the reference site appears to. Rejected — there is no per-source enable/disable in the current model, and adding one is a model change, not a layout change. It belongs in its own proposal.

### 6. Add an optional `onBeforeStep` hook to the tutorial step type

The spec requires that a tour step targeting content inside the collapsed band expands the band first. `TutorialStep` has no lifecycle hook, so the tour cannot currently reveal hidden targets.

Add an optional `onBeforeStep?: () => void` to `TutorialStep` in `src/components/tutorial/types.ts`, invoked by the step runner before the target is resolved. Carat steps that target band content use it to open the band and select the correct tab.

**Scope note:** this touches shared tutorial infrastructure used by five tutorials, not only the carat module. The change is additive and optional, so existing steps are unaffected.

**Alternative considered:** re-point the affected steps at targets that are always visible, such as the collapsed band header. Rejected — it removes the tour's ability to explain income settings, which is a substantial part of what the tour is for.

**Alternative considered:** force the band open for the duration of the tour. Rejected — it shows the user a layout state that differs from the one they will return to, which is worse for a tour whose purpose is orientation.

### 7. Overflow is verified in a real browser; jsdom guards the structural contract

jsdom does not perform layout. `clientWidth` and `scrollWidth` are always zero, so the spec's overflow scenarios cannot be asserted in the existing Vitest setup.

Two-part approach:

- **Automated, in jsdom:** assert the structural contract that makes overflow impossible — the plan container has `min-w-0` and its inner wrapper has `overflow-x-auto`. This catches the specific regression class (a flexible container regaining an automatic content-based minimum) at CI speed.
- **Manual, in a real browser:** verify `scrollWidth <= clientWidth` on the page container at 360, 768, 1024, and 1440 pixels with a populated plan. The `agent-browser` CLI available in this environment can perform this directly.

**Alternative considered:** adopt `@vitest/browser` or Playwright to automate the measurement. Rejected for this change — it introduces a browser runner, a CI job, and a new dependency class to assert two numbers. It is the right answer if the repository later needs broader end-to-end coverage, at which point these scenarios should move into it.

**Consequence to accept:** the overflow scenarios in the spec are validated, but not by CI. A future regression is caught by the structural test only if it takes the same form.

**Superseded after implementation.** At the author's direction, Playwright was adopted after all, and every manual gate in task group 8 now has an automated counterpart under `e2e/` (`pnpm run test:e2e`). The overflow scenarios are measured in a real browser at 360, 768, 1024, and 1440 pixels; the guided tour, drag-to-reorder, and the share-code round trip are covered too. The jsdom structural test is kept as the fast first signal. The consequence recorded above no longer applies.

### 8. Both breakpoint branches keep their presentation, and the branch condition is unchanged

`useWideViewport` (`src/modules/carat/components/use-wide-viewport.ts`) switches the plan between a table and stacked cards at 1024 pixels. That threshold stays. The band and the statistics strip render identically in both branches and are not part of the switch, which is what the spec's ordering requirement asks for.

The empty state text is duplicated between the two branches (`banner-plan-table.tsx:172-183` and `:207-216`). Both copies change under this proposal — the instruction "Set your available carats and tickets above" is no longer accurate. Extract the empty state into a single component rather than editing both copies.

### 9. The page becomes the scroll container

Removing `lg:overflow-hidden` from the page container and the inner panel's own scroll means the document scrolls. This affects `@dnd-kit` auto-scroll during a drag, which currently operates within the inner panel.

`@dnd-kit`'s auto-scroll defaults to the nearest scrollable ancestor and handles the document as a scroll container without configuration, so no explicit option is expected to be needed. This is an expectation, not a certainty, and drag-to-reorder near the viewport edge with a plan longer than the viewport is called out as a required manual check.

## Risks / Trade-offs

- **Guided tour breaks silently** → A missing selector renders no highlight rather than throwing. Mitigation: the spec requires an end-to-end tour pass; treat it as a release gate, not a spot check.
- **Auto-scroll regresses during drag** (Decision 9) → Mitigation: explicit manual verification at both breakpoints with a plan taller than the viewport, before merge.
- **CI cannot catch a recurrence of the original defect** (Decision 7) → Mitigation: the structural test covers the known form. Accepted knowingly; revisit if the defect recurs in a different form.
- **Income settings become less discoverable** → Mitigation: the collapsed summary. This is a genuine trade-off, not a fully solved problem; it is the same one the reference implementation makes.
- **Onboarding order weakens** → Starting carats stop being visibly "step 1" of the plan. Mitigation: rewrite the empty state to point at the Balance group (Decision 8) and re-order the tour to visit it early.
- **Shared tutorial type changes** (Decision 6) → An additive optional field cannot break existing steps, but it does widen the change's blast radius beyond the carat module. Reviewers should be told to expect it.

## Migration Plan

No data migration. The persisted plan shape, share codes, and the model layer are untouched, so a saved plan loads identically before and after.

Deployment is a normal release. Rollback is a revert of the change; because no stored data changes shape, a revert cannot strand a plan saved under the new layout.

## Open Questions

- Whether the statistics strip should remain visible when the assumptions band is expanded, or collapse to save vertical space. Either behavior satisfies the specs, and the choice is better made once the strip exists and can be looked at.
