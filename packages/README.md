# uma-sim (Rust workspace)

Rust port of the Uma Musume race simulator, organized with **Domain-Driven
Design**. The engine is split into two purpose-built simulators over a shared
package of pure primitives (see [ADR-0005](../docs/adr/0005-split-sim-engines.md)):

| Crate | Role |
|-------|------|
| [`uma-sim-primitives`](./uma-sim-primitives) | Pure, field-agnostic primitives: formulas, the `Runner` state + step kernel, condition language, course math, RNG, data models, and field-agnostic race support. The single source of game fidelity. |
| [`uma-sim-race`](./uma-sim-race) | Contested engine — 9 real runners with emergent contention (dueling / spot-struggle / position-keep) and live condition resolution. Drives `runRaceSim` + the streaming simulator. |
| [`uma-sim-vacuum`](./uma-sim-vacuum) | Solo / compare engine — synthetic dueling + approximate conditions, paired-delta orchestration. Drives `runCompare`. |
| [`uma-sim-wasm`](./uma-sim-wasm) | WebAssembly adapter (anti-corruption layer) for browser web workers. Depends on both engines. |

See [`../.plans/rust-sim-engine/`](../.plans/rust-sim-engine) for the full design
context, bounded-context layout, and task plan.

## Quick start

All commands run from this `packages/` directory.

```bash
cargo test --workspace --lib     # run unit tests
cargo lint                       # clippy with -D warnings (alias)
cargo fmt                        # format
cargo wasm                       # build the WASM crate (release)
```

## Code-quality stack

Quality is enforced the same way locally and in CI (see
[`../.github/workflows/rust-ci.yml`](../.github/workflows/rust-ci.yml)). The
design principle: lints are `warn` in config, but CI runs
`clippy -- -D warnings`, so **nothing merges with warnings**.

| Tool | Config | What it enforces |
|------|--------|------------------|
| rustfmt | [`rustfmt.toml`](./rustfmt.toml) | Consistent formatting (width 100). |
| clippy | [`clippy.toml`](./clippy.toml) + `[workspace.lints]` in [`Cargo.toml`](./Cargo.toml) | Zero-warning lint bar; bans `unwrap()`/panic-prone calls; complexity thresholds; anti-AI-slop lints. |
| cargo-deny | [`deny.toml`](./deny.toml) | License compliance, advisories, banned crates, trusted sources. |
| cargo-machete | — | Unused dependencies. |

### Run the gates locally

```bash
# Full suite (mirrors CI). Requires: cargo-deny and cargo-machete.
./scripts/quality-gates.sh

# Fast subset (fmt + clippy + tests):
./scripts/quality-gates.sh --quick
```

Install the optional tools once:

```bash
cargo install cargo-deny cargo-machete
```

### Pre-commit hook

Install a hook that runs the quick gates whenever staged changes touch
`packages/**/*.rs`:

```bash
./scripts/install-hooks.sh        # skip a run with: git commit --no-verify
```

## Toolchain note (WASM target)

CI and rustup-managed dev machines build the WASM target automatically (the
toolchain is declared in [`rust-toolchain.toml`](./rust-toolchain.toml)).

If your machine has a **standalone (non-rustup) Rust install** on `PATH`, it
will shadow rustup and lacks the `wasm32-unknown-unknown` std, so the local
`cargo wasm` / WASM gate is skipped with a notice. To build WASM locally, use a
rustup toolchain:

```bash
rustup target add wasm32-unknown-unknown
```
