# honse-sim

## What this is

This repository is a Rust workspace for deterministic Uma Musume race simulation. The `honse-sim` crate owns shared mechanics plus contested and synthetic engines. The `honse-sim-wasm` adapter generates the npm package named `honse-sim`.

## Stack

| Area | Technology |
|---|---|
| Domain and engines | Rust 2021 |
| Browser boundary | `wasm-bindgen`, serde, WebAssembly |
| Tests | Rust unit, integration, and documentation tests |
| Quality | rustfmt, Clippy, cargo-deny, cargo-machete |
| Distribution | crates.io, npm, GitHub Releases |

## Commands

| Task | Command |
|---|---|
| Format | `cargo fmt` |
| Check formatting | `cargo fmt --check` |
| Lint | `cargo lint` |
| Test | `cargo test --workspace` |
| Check all native targets | `cargo qa` |
| Build WASM target | `cargo wasm` |
| Build npm package | `./scripts/package-npm.sh` |
| Validate release version | `./scripts/validate-release-version.sh <version>` |
| Run quick gates | `./scripts/quality-gates.sh --quick` |
| Run full gates | `./scripts/quality-gates.sh` |
| Score captured races (local only) | `cargo test -p honse-sim-wasm --test capture_accuracy -- --ignored --nocapture` |
| Accept a new accuracy baseline | `UPDATE_ACCURACY_BASELINE=1 cargo test -p honse-sim-wasm --test capture_accuracy -- --ignored` |

## Rules

- **Rust-only boundary:** Keep frontend code, Node application tooling, application state, and deployment outside this workspace. npm commands in this repository only package the generated WASM artifact. The one exception is `tools/`, which holds standalone capture utilities that produce inputs for downstream consumers; nothing in the Rust workspace may depend on it.
- **Crate publication:** Publish only `honse-sim` to crates.io. Keep `honse-sim-wasm` configured with `publish = false`.
- **Contribution licensing:** Do not accept external code contributions until the project has an approved contributor agreement with relicensing permission.
- **Shared version:** Use `workspace.package.version` for the Rust crate, WASM adapter, npm package, Git tag, and GitHub Release.
- **Mechanics source:** Treat `docs/mechanics/README.md` and `docs/mechanics/quick-reference.md` as the mechanics source of truth. Update them with cited evidence when behavior changes.
- **Shared kernel:** Keep `honse-sim/src/primitives/` independent of field ownership and engine orchestration. Engines resolve `FieldInputs` before they call the runner step kernel.
- **Tick consistency:** Build contested inputs from one field snapshot per tick so all runners observe the same pre-update state.
- **Round determinism:** Reset reusable state in `prepare_round`. A round must depend only on its inputs and seed.
- **WASM boundary:** Keep DTO conversion and validation in `honse-sim-wasm`. Coordinate exported contract changes with downstream consumers.
- **Optional DTO fields:** Use `Option<T>` for optional WASM DTO fields. Serde defaults apply to absent keys, not present keys with `undefined` values.
- **Generated npm package:** Use `scripts/package-npm.sh`. Preserve the `uma_sim_wasm` entry point and asset names. Generated files under `honse-sim-wasm/pkg/` are not source files.
- **Release safety:** Do not publish, tag, or create a GitHub Release outside the manual release workflow. The first crates.io publish uses the bootstrap token; later releases use OIDC.
- **Capture accuracy:** `honse-sim-wasm/tests/capture_accuracy.rs` replays real game races and gates against `baseline.json`. It is a local harness (`#[ignore]`, run with `--ignored`), not a CI gate. Run it before and after a mechanics change; a change that moves the scores on purpose must update the baseline in the same change and say why. Fixtures come from torena-hub's `pnpm run race:fixture`, never by hand.
- **Delegated verification:** Re-run the relevant Cargo gates and inspect risky diffs before accepting delegated work.

## Key paths

```text
honse-sim/src/primitives/  shared domain, formulas, runner kernel, skills, stamina
honse-sim/src/contested/   contested field aggregate and use cases
honse-sim/src/vacuum/      synthetic comparison aggregate and use cases
honse-sim-wasm/            external DTO and WebAssembly adapter
docs/mechanics/            mechanics evidence, formulas, and limitations
docs/simulation/           engine design patterns
scripts/                   local quality, package, release, and hook scripts
honse-sim-wasm/tests/fixtures/captures/  real game races (engine input + decoded replay) and the accuracy baseline
tools/                     standalone capture utilities, outside the Rust workspace
```

## Gotchas

- Rust source changes do not update `honse-sim-wasm/pkg/` until `scripts/package-npm.sh` runs.
- `cargo test --workspace --lib` omits integration tests. Use `cargo test --workspace` for the complete suite.
- crates.io and npm versions are immutable. A release rerun must skip an exact version that already exists.
- The WASM adapter receives JavaScript values, but this repository does not own their TypeScript definitions or application adapters.
