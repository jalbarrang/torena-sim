# Architecture Decision Records

These records were written in the `torena-hub` repository before the engine's decisions were recognised as belonging here. That repository has since retired ADRs in favour of OpenSpec specs, and these two moved rather than being ported, because they describe engine architecture and mechanics that this repository owns.

| ADR | Subject |
| --- | --- |
| [0005](0005-split-sim-engines.md) | Two simulation engines over shared pure primitives |
| [0008](0008-runtime-effect-value-scaling.md) | Runtime effect value scaling |

The numbering is inherited and non-contiguous. Keep it: the gaps are meaningful, since the missing numbers were real records that either moved into `torena-hub`'s specs or were dropped.

## Retired records these two reference

Both files cite sibling ADRs that no longer exist anywhere. They are named here so a reader is not left searching:

- **ADR-0003, runtime simulatability gate** — still live behaviour, now specified in `torena-hub` at `openspec/specs/skill-simulatability/spec.md`. ADR-0008's consequence about unsupported value policies feeding that gate remains true.
- **ADR-0004, WASM-vs-TS statistical parity sign-off**, and **ADR-0006, retire the TypeScript simulation oracle** — both dropped, and both obsolete rather than merely retired. The TypeScript engine, the parity harness, and the tolerances 0004 pinned are all gone; this crate is the only simulation path and has been for some time. The three per-skill bugs 0004's amendment uncovered are fixed in engine code and guarded by this repository's own tests, so nothing depends on those records.

Recoverable from `torena-hub`'s git history if the full text is ever wanted.
