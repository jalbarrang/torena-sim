# honse-sim

`honse-sim` is a Rust workspace for deterministic Uma Musume: Pretty Derby race simulation. It contains the simulation engine and its WebAssembly adapter.

## Workspace

| Package | Purpose |
|---|---|
| [`honse-sim`](honse-sim/) | Shared mechanics plus contested and synthetic race engines. |
| [`honse-sim-wasm`](honse-sim-wasm/) | DTO validation and WebAssembly bindings. |

The crate exposes shared mechanics at its root and through `honse_sim::primitives`. Live-field orchestration is in `honse_sim::contested`. Synthetic comparison orchestration is in `honse_sim::vacuum`.

## Requirements

Install the Rust toolchain from [`rust-toolchain.toml`](rust-toolchain.toml). Add the WASM target if your toolchain manager does not install it automatically.

```bash
rustup target add wasm32-unknown-unknown
```

Install `wasm-pack` to build the npm package.

```bash
cargo install wasm-pack --version 0.15.0 --locked
```

Install the pinned release tools to calculate and apply versions locally.

```bash
cargo install git-cliff --version 2.13.1 --locked
cargo install cargo-edit --version 0.13.11 --locked
```

## Commands

Run all commands from the repository root.

```bash
cargo test --workspace
cargo lint
cargo fmt --check
cargo qa
cargo wasm
```

Run the local quality gates before you push a change.

```bash
./scripts/quality-gates.sh
./scripts/quality-gates.sh --quick
```

## npm package

Consumers install the generated WebAssembly package from npm.

```bash
npm install honse-sim
```

Build the package deterministically from the shared workspace version.

```bash
./scripts/package-npm.sh
```

The script runs `wasm-pack`, preserves the existing `uma_sim_wasm` JavaScript and asset names, and normalizes `honse-sim-wasm/pkg/package.json`. Generated files remain ignored.

## Releases

All Rust and npm artifacts use the workspace version in [`Cargo.toml`](Cargo.toml). Calculate the next version from Conventional Commits and apply it to the workspace.

```bash
./scripts/bump-version.sh
```

The script uses [`cliff.toml`](cliff.toml) and commits after the latest `vX.Y.Z` tag. A `BREAKING CHANGE` footer or `!` increments the major version. A `feat` commit increments the minor version. Other included changes increment the patch version. Release commits do not increment the version. The initial version is `v0.1.1` because this repository does not have a Git release tag yet.

Review the version diff. Commit it to `main`, and run the full gates. Then start the manual [`Release`](.github/workflows/release.yml) workflow. The workflow reads the version from `Cargo.toml`, validates it, and runs the gates and package dry-runs again. It creates an immutable version tag, publishes crates.io before npm, and then creates a GitHub Release with generated notes. Reruns resolve the existing tag and skip registry versions that already exist.

The first crates.io release must use the temporary `CRATES_IO_BOOTSTRAP_TOKEN` repository secret. Later releases use crates.io trusted publishing. npm releases use trusted publishing.

## Mechanics documentation

- [`docs/mechanics/README.md`](docs/mechanics/README.md) contains the detailed mechanics model.
- [`docs/mechanics/quick-reference.md`](docs/mechanics/quick-reference.md) contains formulas and known limitations.
- [`docs/simulation/patterns.md`](docs/simulation/patterns.md) describes the two engine patterns.

Race mechanics are reverse-engineered and can contain errors. Update the mechanics documentation and cite the source when new evidence changes an implemented rule.

## License

The Rust crate and npm package use the [GPL-3.0-only](LICENSE) license.
