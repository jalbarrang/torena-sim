# contested-field — intent context

Compiled intent for the `contested-field` initiative (2–12 uma compare with pairwise A/B, C2 design). Check with:

```sh
hiker check .hiker/tents/contested-field/contested-field.tent
# OK: 6 sorts, 6 relations, 6 laws
```

## The invariants (and the collapse each prevents)

| Law | Invariant | Collapse it prevents | Code anchor |
|-----|-----------|----------------------|-------------|
| `race_sim_field_valid` | `run_race_sim` field is **exactly 9** | Raising the contested ceiling "unifies" both regimes and race-sim starts accepting 12 | `packages/uma-sim-race/src/simulation.rs` (`FIELD_SIZE`, `run_race_sim` validation) |
| `contested_field_valid` | contested compare accepts **2..=12** | Ceiling silently stays 9 (validation not updated) or loses the floor of 2 | `run_contested_compare` validation, `MAX_CONTESTED_FIELD` |
| `mob_fill_valid` | engine fill target ∈ `[runnerCount, 12]` | Padding below the real runner count, or past the engine ceiling | engine `fill_to` validation; TS `computeFillTo(runnerCount, fieldSize)` in `wasm-compare-plan.ts`. The user-facing `fieldSize` setting (compare.store, default 9 per the field-composition experiment) is clamped `[2, 12]`; fill mobs are flat 600-stat runners cycling the standard strategy mix (`mob.rs CONTESTED_FILL_MOB_STATS`, overridable via `mobStats` in the WASM params) |
| `vacuum_run_is_duo` | user-facing vacuum compare is **duo-only** (`fieldSize == 2`) | Allowing vacuum at field > 2, or treating vacuum as the default mode instead of an opt-in | `compare.store.ts` (`DEFAULT_COMPARE_MODE = 'contested'`, `canUseVacuum` / `forceContestedForField`); vacuum plan/run path in `wasm-compare-plan.ts` / `wasm-compare.ts` |
| `pair_insertion_order` | Compare A at engine index 0, B at index 1 | Reordering runners in params silently swaps every pairwise stat (trace split keys on insertion order) | `contestedCompareParamsToWasm` callers; split at `wasm-compare.ts` (`splitContestedCompareRounds`) |
| `legacy_snapshot_decode` | legacy/pre-mode shares without compare mode ⇒ contested + 2-field | Importing old vacuum shares into a mob-filled field, hiding the closest surviving head-to-head analogue and warning path | `src/modules/simulation/share/snapshot.ts` version dispatch (`coercedFromVacuum`) |

Mode encoding used by the store/UI: `0 = contested` (default), `1 = vacuum` (opt-in, duo-only). Contested remains the default compare mode; vacuum is reinstated as a user-facing toggle valid only when the field has exactly two runners. Hiker cannot express disjunction (`mode == 0 or (mode == 1 and fieldSize == 2)`), so vacuum duo-only is a `VacuumRun` sort/law and contested-default lives in store defaults plus docs. Batch vacuum engine paths also remain for planner/basin sims outside this intent.

## Expressiveness boundary

- The `fieldSize` default of 9 and the "no padding when target ≤ runner count" rule are not expressible (no arithmetic / defaults in laws); the laws pin the **bounds** only. The exact mapping is covered by `computeFillTo` unit tests.
- Mob stat level (600) is a default, not a law; covered by `mob.rs` unit tests.
- `compareA !== compareB` (pair distinctness) is not expressible (no `!=`); covered by runners.store unit tests.
- Contested-as-default (`DEFAULT_COMPARE_MODE`) is not expressible as a law over mode without `or`; covered by compare.store unit tests and the vacuum duo law above.
- Totality of the snapshot version dispatch (v2 / v1 / undefined) is not expressible; covered by `snapshot.test.ts` legacy fixtures.

## Enforcement

- `hiker check` (this spec compiles) runs via the `intent` script: `pnpm run intent`.
- `gen` (property-test bridge) is deferred until the initiative's code exists: the natural SUT functions are the TS-side validators (e.g. a `contestedFieldValid(f)` predicate) once the store plan lands. Regenerate into `.hiker-cache/` (gitignored), never commit generated tests.
