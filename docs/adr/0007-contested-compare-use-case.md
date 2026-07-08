# ADR-0007: Contested Compare as a Third Use Case

## Status

Accepted

Amends [ADR-0005](0005-split-sim-engines.md).

## Context

ADR-0005 split simulation into two engines over shared primitives: `uma-sim-race` for live contested fields and `uma-sim-vacuum` for synthetic solo/compare runs. The original compare path uses the vacuum engine, so mechanics that require live field proximity, especially spot-struggle and the harsher Runaway spot-struggle HP drain, do not emerge unless users manually force regions. User feedback showed this makes compare results surprising because same-race benchmark tools expose those states naturally.

## Decision

Add contested compare as a separate use-case composition: run the existing `uma-sim-race` contested engine with 2..=12 compared runners, optionally fill the field with generated mobs to a configurable target size (`fill_to`, up to 12), and attach the shared compare-grade telemetry collector.

> Amended by the contested-field initiative: the compared-runner ceiling was raised from 9 to 12 (`MAX_CONTESTED_FIELD`) and the boolean mob fill became a configurable `fill_to` target; `run_race_sim` remains exactly 9. Keep vacuum compare as the isolated paired-delta use case. The compare collector and DTO-shaped read-model types live in `uma-sim-primitives::compare` because they depend only on the observer/projection primitives and are valid for both engines.

This is not a mode flag inside formulas or the shared step kernel. Formula code stays field-agnostic; the difference remains at orchestration boundaries: vacuum compare synthesizes absent field inputs in `uma-sim-vacuum`, while contested compare obtains field inputs from a live `uma-sim-race` field and projects the same compare telemetry shape.

## Consequences

- Same-race compare can surface field-dependent mechanics such as spot-struggle, dueling, blocking, and runner-to-runner debuffs without synthetic approximations.
- Vacuum compare remains available when callers need isolated build-quality deltas without direct head-to-head interaction.
- Contested compare deltas measure head-to-head performance in a shared race, so runner results are intentionally correlated and may have different variance from vacuum paired deltas.
- Compare telemetry can be reused across engines, but contested compare should collect only focus runners when mobs are present to keep payload size bounded.
