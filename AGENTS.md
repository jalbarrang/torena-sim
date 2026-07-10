# Umalator Global

## Subagents

- **Never trust subagent completion reports.** A subagent's "all gates pass" is a claim, not a fact. Before marking delegated work done: re-run the gates yourself (`typecheck`, `test`, `intent`), spot-check the riskiest diffs, and sweep for stragglers (`rg` every removed symbol). Only then sign off.

## Dev Server

- **Never** run `pnpm run dev`, `vite`, or any development server commands. The user manages the dev server themselves.

## Package Management

- Use `pnpm` for package management, avoid using `bun`/`npm`/`yarn`.
- CLI scripts run on Node 26 via `tsx` (never `bun`); sqlite access uses `node:sqlite`.
- Prefer using the available `package.json` scripts instead of running commands directly for typechecking, linting, formatting, testing, etc.

## Code Style

- Never create barrel files, always use named exports.

## React Patterns

- This project uses Base UI patterns, not older Radix-style composition.
- Do not assume local wrapper components support `asChild`.
- Before using common shadcn or Radix idioms, check the local wrapper API first.
- Prefer the repo's existing `render={...}` composition patterns when working with triggers and buttons.
- Destructure props inside the component body, not in the function signature.
- use `type` instead of `interface` for component props.
- Don't overuse `useEffect` for simple state updates.
- Don't use deprecated `forwardRef` for component refs, pass the `ref` as a prop.
- This project should follow the React 19+ composition patterns.
- This project doesn't use React Server Components.

## Simulation Engine (packages/)

- **Rust changes are invisible until rebuilt.** The app imports the compiled WASM from `src/lib/uma-sim-wasm/pkg/` (gitignored, rebuilt in CI). After any change under `packages/`, run `pnpm run wasm:build` and hard-refresh the browser — otherwise the dev app silently runs the old engine.
- **JS→WASM boundary: present-but-`undefined` keys are unit values, not absent.** serde's `#[serde(default)]` only fires for absent keys. Optional DTO fields in `packages/uma-sim-wasm/src/dto.rs` must be `Option<T>`, never bare types with defaults.
- **Race-mechanics canon:** `docs/mechanics/README.md` + `quick-reference.md` are the source of truth for mechanics. Check them before implementing; when new evidence supersedes them, amend the doc in the same change, citing the source.
