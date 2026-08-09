# Contributing to honse-sim

## Repository boundary

This repository contains the Rust simulation engine and its WebAssembly adapter.

Keep application tooling out of this workspace. Coordinate WASM DTO and exported-function changes with downstream consumers.

## Contribution licensing

External code contributions require a project-approved contributor agreement that includes the necessary relicensing permission. The project does not accept external code contributions until that agreement exists. Issue reports and design feedback remain welcome.

## Workspace structure

| Path | Purpose |
|---|---|
| `honse-sim/src/primitives/` | Field-independent values, formulas, runner state, skills, stamina, and observers. |
| `honse-sim/src/contested/` | Live-field orchestration and race telemetry. |
| `honse-sim/src/vacuum/` | Synthetic comparison orchestration. |
| `honse-sim-wasm/` | Serde and `wasm-bindgen` boundary. |
| `docs/mechanics/` | Mechanics sources, formulas, assumptions, and limitations. |
| `scripts/` | Quality, package, release-validation, and Git hook scripts. |

The `honse-sim` package is the only crates.io package. Keep its shared kernel independent of engine orchestration. Keep `honse-sim-wasm` configured with `publish = false`.

## Development workflow

Format and validate the workspace.

```bash
cargo fmt
cargo lint
cargo test --workspace
cargo qa
```

Build the WebAssembly target.

```bash
cargo wasm
```

Run the full local gate before you push.

```bash
./scripts/quality-gates.sh
```

## Mechanics changes

Read [`docs/mechanics/README.md`](docs/mechanics/README.md) and [`docs/mechanics/quick-reference.md`](docs/mechanics/quick-reference.md) before you change race behavior.

Add or update tests for each mechanics change. Use deterministic seeds and assert the domain result, not incidental log text.

Update the mechanics documentation in the same change when new evidence changes a formula or rule. Cite the source and mark assumptions explicitly.

The contested engine must build inputs from one immutable field snapshot per tick. Each round must depend only on its inputs and seed. Reset reusable state in `prepare_round`.

## WASM boundary changes

Keep external DTO conversion in `honse-sim-wasm/`. Use `Option<T>` for optional DTO fields because a present JavaScript key with an `undefined` value is not an absent serde field.

Build and inspect the npm package after each boundary change.

```bash
./scripts/package-npm.sh
cd honse-sim-wasm/pkg && npm pack --dry-run
```

The package script preserves the existing JavaScript entry point and WASM asset names. Do not edit generated files manually.

## Version and release process

The workspace version in `Cargo.toml` is the only version source. The Rust crate, WASM adapter, npm package, Git tag, and GitHub Release use that value.

Prepare a release as follows:

1. Update `workspace.package.version` in `Cargo.toml`.
2. Run `cargo check --workspace` to update `Cargo.lock`.
3. Run `./scripts/validate-release-version.sh <version>`.
4. Run `./scripts/quality-gates.sh`.
5. Commit and merge the version change to `main`.
6. Dispatch the `Release` workflow with the exact version and no `v` prefix.

The workflow creates the immutable `v<version>` tag after verification and before registry publication. It publishes only `honse-sim` to crates.io. It builds `honse-sim-wasm` and publishes the generated package as `honse-sim` on npm. It creates a GitHub Release with generated notes after registry publication succeeds.

The first crates.io publication must use the `CRATES_IO_BOOTSTRAP_TOKEN` repository secret. Remove that secret after you configure crates.io trusted publishing for `.github/workflows/release.yml` and the `release` environment. Configure npm trusted publishing for the same workflow and environment.

## Pull request checklist

- Run `cargo fmt --check`.
- Run `cargo lint`.
- Run `cargo test --workspace`.
- Run `cargo qa`.
- Update mechanics documentation for behavior changes.
- Describe WASM contract changes and the required downstream consumer changes.
