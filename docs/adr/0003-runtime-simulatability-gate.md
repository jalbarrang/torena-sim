# ADR-0003: Simulatability as a Runtime Gate Derived from Supported Mechanics

## Status

Accepted

## Context

Upcoming skills from GameTora may contain condition tokens or effect value policies that the simulation engine does not support. The condition parser crashes at runtime on unknown tokens — an `Identifier` lookup returns `undefined`, and the first operator that calls `.filterEq()` on it throws an unrecoverable error. Unsupported value policies are also unsafe: treating them as Direct silently simulates mechanics the engine does not implement. A single unsupported skill must not crash or corrupt the entire simulation run.

We considered three approaches:

1. **Store a `simulatable` flag in the data** — set during extraction, checked by consumers.
2. **Separate files for simulatable vs non-simulatable skills** — two data files, service merges them.
3. **Derive simulatability at runtime from the condition parser's known token set** — no stored flag, the check auto-updates when engine support is added.

## Decision

Derive simulatability at runtime by validating each skill's condition and precondition strings against the set of tokens recognized by the condition parser (`knownConditionTokens`) and each effect value policy against the supported policy set.

- `SkillService.isSimulatable(skillId)` checks and caches the result per skill.
- `buildSkillData` in the simulator guards against non-simulatable skills, returning empty triggers with a dev-mode warning instead of crashing.
- Display features (charts, search, filtering) show all skills regardless of simulatability, using `isSimulatable()` to badge or annotate non-simulatable entries.
- Simulation features (compare mode, skill planner) silently exclude non-simulatable skills.

## Consequences

- **Self-healing**: when a new condition token is implemented in the engine, all skills using it automatically become simulatable. No data migration or re-extraction needed.
- **No crash risk**: the `buildSkillData` guard is a safety net even if `isSimulatable` is bypassed.
- **Small runtime cost**: tokenizing condition strings and checking against a `Set` is negligible, and results are cached per skill ID.
- **Unsupported effect value policies are gated**: policy support is explicit in both TypeScript preflight and the WASM DTO backstop. See [ADR-0008](0008-runtime-effect-value-scaling.md).
- **Display-simulation boundary is clear**: the simulatability check is the single point that separates "can be shown" from "can be run." Both sides consume the same data.
