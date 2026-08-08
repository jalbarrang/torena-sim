# End-to-end tests

Playwright specs that drive the real app in Chromium. They cover what jsdom cannot: layout, overflow measurement, pointer-driven drag, and the guided tour's runtime selector resolution.

```bash
pnpm run test:e2e            # headless, both projects
pnpm run test:e2e:ui         # interactive runner
pnpm run test:e2e:report     # open the last HTML report
pnpm exec playwright test --repeat-each=3   # flake check
```

Unit tests (`pnpm run test`) exclude this directory; `e2e/` has its own runner.

## Dev server

`playwright.config.ts` reuses a dev server already running on `localhost:5173` and only starts one when none is up (`reuseExistingServer: !process.env.CI`). Point it elsewhere with `E2E_BASE_URL` or `E2E_PORT`.

## Determinism

The live timeline Worker serves ~1000 events whose dates track the real game schedule, so assertions against it would drift. `e2e/fixtures/timeline.ts` stubs `**/timeline` with eight events whose dates are computed relative to the moment the fixture is built — planned banners are always upcoming, and the same reward events always fall inside the 365-day projection window.

Storage needs no explicit reset: each test gets a fresh browser context. Do not add an `addInitScript` that clears `localStorage` — it runs on every navigation and would defeat the persistence spec.

## Projects

| Project | Viewport | Runs |
| --- | --- | --- |
| `chromium-desktop` | 1440×900 | everything except `*.mobile.spec.ts` |
| `chromium-mobile` | Pixel 7 | `*.mobile.spec.ts` only |

The plan switches between a table and stacked cards at 1024px, so the narrow branch needs its own project rather than a viewport call mid-test.

## Layout

- `fixtures/carat-calculator.ts` — the `caratPage` fixture and its page object. Add locators here, not in specs.
- `fixtures/timeline.ts` — the stubbed payload and the banner titles specs refer to.
- `carat-calculator/*.spec.ts` — one file per concern.

## Gotchas found while writing these

- **Ticket auto-fill makes cost non-deterministic.** Planned banners draw from ticket pools that accrue between today and the banner date, discounting the carat cost by a date-dependent amount. Pin tickets with `ticketsInput(title).fill('0')` before asserting an exact cost.
- **"Short" is ambiguous.** The affordability badge and the "short by …" explanation both match. Use `verdictBadge()`, which matches exactly.
- **dnd-kit needs a real drag gesture.** `dragTo()` does not activate its pointer sensor; move to the handle, `mouse.down()`, several intermediate `mouse.move()` calls, then `mouse.up()`.
- **The band's groups leave the DOM when collapsed.** Assert `getByRole('tab')` has count 0 rather than checking visibility.
