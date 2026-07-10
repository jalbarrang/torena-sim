# Contributing to Torena Sim

## Introduction

This guide will help you set up a development environment, understand the codebase structure, and contribute to the Torena Sim project. Whether you're updating game data, fixing bugs, or adding new features, this document provides the information you need.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** v24 or later
- **pnpm** (the project's package manager, specified in `packageManager` field)
- **Node 26+** (CLI scripts run via `tsx` and use `node:sqlite`)

### Game Data Access

The project ships with pre-extracted JSON data in `src/modules/data/`, so you can run the app without the game database. If you want to re-extract data from the source database:

**Option A: Download via script (recommended)**

```bash
pnpm run db:fetch <version-id> # e.g. 10004010
```

This downloads `master.mdb` into `db/master.mdb`, which the extraction scripts detect automatically.

**Option B: Copy from a local game installation**

Copy your `master.mdb` file to `db/master.mdb` at the project root. See [`scripts/README.md`](scripts/README.md) for platform-specific paths.

The `db/` directory is gitignored.

## Project Structure

```
umalator-global/
├── src/                              # Application source
│   ├── main.tsx                      # Entry point (HashRouter, theme provider)
│   │
│   ├── routes/                       # React Router page routes
│   │   ├── root.tsx                  # Root layout and route definitions
│   │   ├── _simulation.tsx           # Simulation section layout
│   │   ├── _simulation/
│   │   │   ├── home.tsx              # Compare tools (default page)
│   │   │   ├── skill-bassin.tsx      # Skill basin comparison
│   │   │   └── uma-bassin.tsx        # Uma basin comparison
│   │   ├── runners.tsx               # Runners section layout
│   │   ├── runners/
│   │   │   ├── home.tsx              # Runner library list
│   │   │   ├── new.tsx               # Create new runner
│   │   │   └── $runnerId.edit.tsx    # Edit existing runner
│   │   ├── skill-planner.tsx         # Skill planner page
│   │   └── stamina-calculator.tsx    # Stamina calculator page
│   │
│   ├── lib/                          # Core libraries
│   │   ├── uma-domain/               # TS domain DTOs, definitions, parser, helpers
│   │   │   ├── course/               # Course data and definitions
│   │   │   ├── race/                 # Race DTO/result/event types and helpers
│   │   │   ├── runner/               # Runner types, definitions, utilities
│   │   │   ├── shared/               # Shared definitions, region, random
│   │   │   └── skills/               # Skill types, definitions, parser, policies
│   │   ├── uma-sim-wasm/             # WASM loader, DTOs, adapters
│   │   ├── feature-flags.ts          # Feature flag utilities
│   │   └── utils.ts                  # General utilities (cn, etc.)
│   │
│   ├── modules/                      # Feature modules
│   │   ├── simulation/               # Simulation UI and orchestration
│   │   │   ├── simulators/           # Compare strategies (skill, uma, vacuum)
│   │   │   ├── hooks/                # Simulation React hooks
│   │   │   ├── stores/               # Zustand stores (compare, skill-basin, uma-basin)
│   │   │   ├── tabs/                 # Result visualization tabs
│   │   │   ├── compare.types.ts      # Compare type definitions
│   │   │   └── types.ts              # Module types
│   │   │
│   │   ├── skills/                   # Skill system
│   │   │   ├── components/           # Skill UI components
│   │   │   ├── store.ts              # Skill selection state
│   │   │   ├── query.ts              # Skill data queries
│   │   │   ├── filters.ts            # Skill filtering logic
│   │   │   ├── effects-query.ts      # Skill effects queries
│   │   │   ├── conditions.ts         # Condition utilities
│   │   │   ├── skill-relationships.ts # Skill relationship mapping
│   │   │   ├── icons.ts              # Skill icon handling
│   │   │   └── utils.ts              # Skill utilities
│   │   │
│   │   ├── racetrack/                # Course visualization
│   │   │   ├── components/           # Track UI components
│   │   │   ├── hooks/                # Track-related hooks
│   │   │   ├── courses.ts            # Course data utilities
│   │   │   ├── labels.ts             # Track labels
│   │   │   └── types.ts              # Track types
│   │   │
│   │   ├── runners/                  # Runner configuration
│   │   │   ├── components/           # Runner UI components
│   │   │   ├── ocr/                  # OCR import functionality
│   │   │   ├── hooks/                # Runner hooks
│   │   │   ├── data/                 # Runner data utilities
│   │   │   └── utils.ts              # Runner utilities
│   │   │
│   │   ├── skill-planner/            # Skill planner feature
│   │   │   ├── components/           # Planner UI components
│   │   │   ├── hooks/                # Planner hooks
│   │   │   ├── skill-planner.store.ts # Planner state
│   │   │   ├── optimization-engine.ts # Skill optimization engine
│   │   │   ├── optimizer.ts          # Optimizer logic
│   │   │   ├── simulator.ts          # Planner simulation runner
│   │   │   ├── cost-calculator.ts    # SP cost calculator
│   │   │   └── types.ts              # Planner types
│   │   │
│   │   ├── tutorial/                 # Tutorial system
│   │   │   ├── steps/                # Tutorial step definitions
│   │   │   └── types.ts              # Tutorial types
│   │   │
│   │   └── data/                     # Game data files (JSON)
│   │       ├── skills.json           # Unified skill data
│   │       ├── course_data.json      # Course/track data
│   │       ├── umas.json             # Uma musume character data
│   │       ├── tracknames.json       # Track name translations
│   │       ├── icons.json            # Icon data
│   │       ├── skill-types.ts        # Skill type definitions
│   │       ├── skills.ts             # Skill data access layer
│   │       └── gametora/             # Gametora sourced data
│   │
│   ├── components/                   # Shared UI components
│   │   ├── ui/                       # shadcn/ui components
│   │   ├── bassin-chart/             # Basinn chart components
│   │   ├── race-settings/            # Race configuration components
│   │   ├── tutorial/                 # Tutorial UI components
│   │   └── ...                       # Modals, overlays, presets, etc.
│   │
│   ├── store/                        # Global Zustand stores
│   │   ├── runners.store.ts          # Runner state management
│   │   ├── runner-library.store.ts   # Runner library state
│   │   ├── settings.store.ts         # Application settings
│   │   ├── ui.store.ts               # UI state (modals, panels)
│   │   ├── tutorial.store.ts         # Tutorial state
│   │   └── race/
│   │       └── preset.store.ts       # Race preset state
│   │
│   ├── workers/                      # Web Workers
│   │   ├── simulator.worker.ts       # Single race simulations
│   │   ├── skill-basin.worker.ts     # Skill basin comparisons
│   │   ├── uma-basin.worker.ts       # Uma basin comparisons
│   │   ├── skill-single.worker.ts    # Single skill simulations
│   │   ├── skill-planner.worker.ts   # Skill planner worker
│   │   ├── ocr.worker.ts             # OCR processing
│   │   ├── pool/                     # Worker pool management
│   │   └── utils.ts                  # Worker utilities
│   │
│   ├── providers/                    # React context providers
│   │   └── theme/                    # Theme provider (light/dark)
│   │
│   ├── layout/                       # Layout components
│   │   ├── left-sidebar.tsx          # Left sidebar layout
│   │   └── runner-editor-layout.tsx  # Runner editor layout
│   │
│   ├── hooks/                        # Shared React hooks
│   │   └── useBreakpoint.ts          # Responsive breakpoint hook
│   │
│   ├── i18n/                         # Internationalization
│   │   ├── index.ts                  # i18next setup
│   │   └── lang/                     # Language files (EN/JA)
│   │
│   ├── utils/                        # Utility functions
│   ├── data/                         # App-level data
│   │   └── changelog.ts              # Changelog entries
│   │
│   ├── app.css                       # Application styles
│   └── styles.css                    # Global / Tailwind styles
│
├── scripts/                          # Data extraction and debug scripts
│   ├── extract-all.ts                # Run all extractions
│   ├── extract-skills.ts             # Extract skill data
│   ├── extract-uma-info.ts           # Extract uma data
│   ├── extract-course-data.ts        # Extract course data
│   ├── fetch-master-db.ts            # Download master.mdb
│   ├── debug-skill-compare.ts        # Skill comparison debugging
│   ├── runner-compare.ts             # Runner comparison script
│   ├── runner-config.schema.ts       # Runner config schema (Zod)
│   ├── lib/                          # Shared script libraries
│   │   ├── database.ts               # SQLite database helpers
│   │   └── shared.ts                 # Shared utilities
│   ├── runners/                      # Runner configuration files
│   ├── skill-lists/                  # Skill list presets
│   ├── legacy/                       # Legacy Perl scripts (reference only)
│   └── README.md                     # Script documentation
│
├── courseeventparams/                # Course event parameter JSONs
│   └── [course files].json           # Course geometry data
│
├── docs/                             # Documentation
│   ├── quick-reference.md            # Race mechanics quick reference
│   ├── race-mechanics.md             # Detailed race mechanics
│   ├── simulator-patterns.md         # Simulator design patterns
│   └── ...                           # Additional documentation
│
├── public/                           # Static assets
│
└── Configuration files
    ├── package.json                  # Dependencies and scripts
    ├── tsconfig.json                 # TypeScript configuration
    ├── vite.config.ts                # Vite build configuration
    ├── eslint.config.js              # ESLint (flat config) linter configuration
    ├── eslint-rules/                 # Project-local ESLint rules (React/Zustand)
    ├── .oxfmtrc.json                 # oxfmt formatter configuration
    ├── .editorconfig                 # Editor configuration
    ├── components.json               # shadcn/ui configuration
    └── .env.example                  # Environment variable template
```

## Development Setup

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/jalbarrang/umalator-global.git
cd umalator-global
pnpm install
```

### 2. Run the Development Server

```bash
pnpm run dev
```

Default port is 5173. Open `http://localhost:5173` in your browser.

### 3. Extract Game Data (Optional)

The repo ships with pre-extracted JSON data, so this step is only needed when updating data after a game patch.

**Fetch the latest database:**

```bash
pnpm run db:fetch
```

**Extract all data at once (merge mode, recommended):**

```bash
pnpm run extract:all
```

Merge mode (the default) updates entries from `master.mdb` while preserving future/datamined content not yet in the database.

**Full replacement mode** (removes future content):

```bash
pnpm run extract:all -- --replace
```

**Extract individual data files:**

```bash
pnpm run extract:skills           # Unified skill data
pnpm run extract:uma-info         # Uma musume data
pnpm run extract:course-data      # Course/track data
```

All scripts support `--replace` for full replacement mode. See [`scripts/README.md`](scripts/README.md) for detailed documentation.

### Build Configuration

The build uses **Vite** with the following plugins (`vite.config.ts`):

- **@vitejs/plugin-react**: React support
- **@tailwindcss/vite**: Tailwind CSS integration
- **vite-tsconfig-paths**: Resolves TypeScript path aliases in both app and worker code

**Path Aliases** (defined in `tsconfig.json`, resolved by `vite-tsconfig-paths`):

- `@/*` → `./src/*`
- `@scripts/*` → `./scripts/*`
- `@workers/*` → `./src/workers/*`

```typescript
import { useSettingsStore } from '@/store/settings.store';
import { runRaceSim } from '@/lib/uma-sim-wasm/loader';
```

**Feature Flags:**

Feature flags are managed via environment variables prefixed with `VITE_FEATURE_`. They are accessible at runtime via `import.meta.env`. See `.env.example` for available flags.

## Technology Stack

- **React 19** with React Router v7 (HashRouter)
- **TypeScript** with strict mode
- **Vite 7** for builds and dev server
- **Tailwind CSS v4** for styling
- **shadcn/ui** (base-nova style) with Base UI React primitives
- **Zustand** for state management
- **Immer** for immutable state updates
- **i18next** for internationalization (EN/JA)
- **Recharts** for chart visualizations
- **Zod** for schema validation
- **Vitest** for unit tests
- **ESLint** (flat config, with `eslint-plugin-unicorn`) for linting
- **oxfmt** for formatting
- **Lucide React** for icons

## Code Structure and Key Components

### Application Entry Point

**`src/main.tsx`** sets up the React root with:

- `HashRouter` for client-side routing
- `ThemeStoreProvider` for light/dark mode
- Immer `MapSet` plugin
- i18n initialization

**`src/routes/root.tsx`** is the root layout component containing:

- Top-level navigation tabs (Compare tools, Skill Planner, Runners)
- React Router `<Routes>` configuration
- Global UI elements (toaster, modals, theme toggle, tutorial)

### Routes

| Route                     | Component        | Description             |
| ------------------------- | ---------------- | ----------------------- |
| `/`                       | `SimulationHome` | Compare tools (default) |
| `/skill-bassin`           | `SkillBassin`    | Skill basin comparison  |
| `/uma-bassin`             | `UmaBassin`      | Uma basin comparison    |
| `/runners`                | `RunnersHome`    | Runner library          |
| `/runners/new`            | `RunnersNew`     | Create new runner       |
| `/runners/:runnerId/edit` | `RunnersEdit`    | Edit runner             |
| `/skill-planner`          | `SkillPlanner`   | Skill planner           |

### Simulation Engine (`packages/uma-sim-*` + `src/lib/uma-sim-wasm/`)

The race simulation engine lives in Rust:

- **`packages/uma-sim-primitives`**: shared formulas, parser, data models, and race-support primitives.
- **`packages/uma-sim-race`**: contested 9-runner race simulation.
- **`packages/uma-sim-vacuum`**: solo/compare simulation.
- **`packages/uma-sim-wasm`**: WebAssembly boundary consumed by the app.
- **`src/lib/uma-sim-wasm/`**: TypeScript loader, DTOs, and app-facing adapters.
- **`src/lib/uma-domain/`**: TypeScript domain definitions, condition parser, and UI/result DTOs.

See `src/lib/uma-sim-wasm/README.md`, `docs/race-mechanics.md`, and `docs/quick-reference.md` for simulation and mechanics notes.

### Simulation Orchestration (`src/modules/simulation/`)

The simulation module connects the engine to the UI:

- **`simulators/`**: Compare strategies (`skill-compare.ts`, `vacuum-compare.ts`, `skill-planner-compare.ts`)
- **`hooks/`**: React hooks for running simulations (compare, skill basin, uma basin)
- **`stores/`**: Zustand stores for simulation state
- **`tabs/`**: Result visualization tab components

### State Management

**Global Stores (`src/store/`):**

- `runners.store.ts` — active runner configuration
- `runner-library.store.ts` — saved runner library
- `settings.store.ts` — application settings
- `ui.store.ts` — UI state (modals, panels)
- `tutorial.store.ts` — tutorial progress
- `race/preset.store.ts` — race presets

**Module Stores** are co-located with their modules (e.g., `simulation/stores/`, `skills/store.ts`, `skill-planner/skill-planner.store.ts`).

### Web Workers (`src/workers/`)

Simulations run in background threads to keep the UI responsive:

- `simulator.worker.ts` — single race simulations
- `skill-basin.worker.ts` — skill basin comparisons
- `uma-basin.worker.ts` — uma performance analysis
- `skill-single.worker.ts` — single skill simulations
- `skill-planner.worker.ts` — skill planner optimization
- `ocr.worker.ts` — OCR image processing
- `pool/` — worker pool management for parallel simulations

### UI Components

**`src/components/ui/`** — shadcn/ui components (Button, Dialog, Select, Tabs, etc.) configured via `components.json`.

**`src/components/bassin-chart/`** — basinn chart components for skill efficacy visualization.

**`src/components/race-settings/`** — race condition selectors (ground, weather, season, time of day).

**`src/components/tutorial/`** — tutorial overlay and popover system.

## Making Code Changes

### Development Workflow

1. **Start the dev server:**

   ```bash
   pnpm run dev
   ```

2. **Check for TypeScript errors:**

   ```bash
   pnpm run typecheck
   ```

3. **Run the linter:**

   ```bash
   pnpm run lint
   ```

4. **Fix lint issues automatically:**

   ```bash
   pnpm run lint:fix
   ```

5. **Format code:**

   ```bash
   pnpm run format
   ```

6. **Check formatting without writing:**

   ```bash
   pnpm run format:check
   ```

7. **Run unit tests:**

   ```bash
   pnpm run test
   ```

8. **Build for production:**

   ```bash
   pnpm run build
   ```

### Code Style

Formatting is enforced by **oxfmt** (`.oxfmtrc.json`):

- 2 spaces for indentation
- Single quotes
- Semicolons required
- 100 character line width
- LF line endings

Linting is enforced by **ESLint** using its flat config (`eslint.config.js`). It layers
`@eslint/js`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`,
`eslint-plugin-jsx-a11y`, and `eslint-plugin-unicorn` (the `unopinionated` preset, with the
finicky/stylistic rules turned off), plus the project-local `react-props` rules in
`eslint-rules/`.

TypeScript strict mode is enabled. Use functional React components with hooks. Style with Tailwind CSS utility classes. Use path aliases for imports.

### Common Development Tasks

#### Adding a New Skill Effect

1. Check if the effect type exists in `src/lib/uma-domain/skills/` and the Rust skill model.
2. Add mechanics handling in the appropriate Rust crate under `packages/uma-sim-*`.
3. Update TypeScript condition parsing if needed in `src/lib/uma-domain/skills/parser/`.
4. Add or update tests in corresponding `*.test.ts` files
5. Test with known skills that use the effect

#### Adding a New UI Feature

1. Create or modify components in the appropriate module directory
2. Update Zustand stores if state management is needed
3. Use shadcn/ui primitives from `src/components/ui/` where possible
4. Use Tailwind CSS for styling
5. Ensure the feature works with the web worker architecture if it involves simulations

#### Updating Course Data

1. Ensure `courseeventparams/` has the latest course geometry JSONs
2. Run the extraction:

```bash
pnpm run extract:course-data
```

3. Verify course geometry in the visualization
4. Test skill activations on the updated course

## Testing

### Unit Tests

Run with Vitest:

```bash
pnpm run test          # Run once
pnpm run test:watch    # Watch mode
```

Add tests in `*.test.ts` files alongside the code they test.

### Manual Testing Checklist

- [ ] Simulations complete without errors
- [ ] Results are consistent with expected race behavior
- [ ] UI is responsive and doesn't freeze
- [ ] Skill activations appear correct on the chart
- [ ] Statistics (min/median/mean/max) are reasonable
- [ ] Changes work in both development and production builds

## CI/CD

### GitHub Actions

**PR Checks** (`.github/workflows/pr-checks.yml`):

Runs on pull requests to `main`:

- TypeScript type checking (`pnpm run typecheck`)
- Linting (`pnpm run lint`)
- Production build validation (`pnpm run build`)

Both workflows use pnpm with a frozen lockfile on Node 26.

### Deployment

The project deploys to **Cloudflare Pages** (https://torena-sim.pages.dev) via `.github/workflows/deploy-cloudflare.yml`.

- Deploys automatically on pushes to `main`
- Uses pnpm + the Rust/wasm toolchain to build the engine
- Reads `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST` from repository variables at build time

> The old GitHub Pages and Netlify URLs now serve a static 301 redirect to the canonical Cloudflare domain.

## Submitting Contributions

### Preparing Your Contribution

1. **Ensure code quality:**

   ```bash
   pnpm run typecheck    # No TypeScript errors
   pnpm run lint         # No linting errors
   pnpm run format:check # Code is formatted
   pnpm run test         # Tests pass
   ```

2. **User-facing changes** use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.) so they appear in the in-app changelog after release. Do not edit `CHANGELOG.md` — deploy CI regenerates it; locally run `pnpm run changelog:generate` after fetching tags.

3. **Test thoroughly:**
   - Run simulations with your changes
   - Check for performance regressions
   - Test multiple running styles, courses, and skill types

4. **Create a pull request:**
   - Describe what you changed and why
   - Include test cases or examples
   - Reference any related issues

### Code Review

Be prepared to:

- Explain your implementation choices
- Make requested changes
- Provide additional testing if needed

## Troubleshooting

### Build Errors

**"Cannot find module":**

- Run `pnpm install` to ensure all dependencies are installed
- Check that import paths are correct
- Verify path aliases are configured in `tsconfig.json`

### Data Extraction Issues

**"Failed to open database":**

- Verify the file path is correct
- Ensure the game is not running (file may be locked)
- Check file permissions

**Empty or invalid JSON:**

- Verify `master.mdb` is from the current game version
- Check console output for script errors

### Runtime Errors

**Worker thread crashes:**

- Check browser console for error messages
- Verify all data files in `src/modules/data/` are valid JSON
- Test with default parameters to isolate the issue

**Simulations freeze:**

- Check for infinite loops in simulation code
- Verify stamina is sufficient for the course
- Use the development build for detailed error messages

### Vite-Specific Issues

**Port already in use:**

- Vite will automatically try the next available port
- Or specify a port: `pnpm run dev -- --port 3000`

**Hot reload not working:**

- Try restarting the dev server
- Clear browser cache

## Additional Resources

- [`scripts/README.md`](scripts/README.md) — data extraction script documentation
- [`src/lib/uma-sim-wasm/README.md`](src/lib/uma-sim-wasm/README.md) — WASM simulation integration documentation
- [`docs/quick-reference.md`](docs/quick-reference.md) — race mechanics quick reference
- [`docs/race-mechanics.md`](docs/race-mechanics.md) — detailed race mechanics
- [`docs/simulator-patterns.md`](docs/simulator-patterns.md) — simulator design patterns

### Original Umalator

The simulator is based on the original Umalator project:

- **Simulator Engine**: [github.com/alpha123/uma-skill-tools](https://github.com/alpha123/uma-skill-tools)
- **UI Components**: [github.com/alpha123/uma-tools](https://github.com/alpha123/uma-tools)

See `README.md` for full acknowledgements.

---

Thank you for contributing to Torena Sim!
