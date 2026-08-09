#!/usr/bin/env bash
# Compute and apply the next workspace version from Conventional Commits.

set -euo pipefail

readonly GIT_CLIFF_VERSION="2.13.1"
readonly CARGO_EDIT_VERSION="0.13.11"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
    echo "The working tree must be clean before a version bump" >&2
    exit 1
fi

if ! command -v git-cliff >/dev/null 2>&1; then
    echo "git-cliff $GIT_CLIFF_VERSION is required" >&2
    echo "Install it with: cargo install git-cliff --version $GIT_CLIFF_VERSION --locked" >&2
    exit 1
fi
if [[ "$(git-cliff --version)" != "git-cliff $GIT_CLIFF_VERSION" ]]; then
    echo "git-cliff $GIT_CLIFF_VERSION is required" >&2
    exit 1
fi

if ! cargo set-version --version >/dev/null 2>&1; then
    echo "cargo-edit $CARGO_EDIT_VERSION is required" >&2
    echo "Install it with: cargo install cargo-edit --version $CARGO_EDIT_VERSION --locked" >&2
    exit 1
fi
if [[ "$(cargo set-version --version)" != "cargo-edit-set-version $CARGO_EDIT_VERSION" ]]; then
    echo "cargo-edit $CARGO_EDIT_VERSION is required" >&2
    exit 1
fi

CURRENT_VERSION=$(python3 - "$REPO_ROOT/Cargo.toml" <<'PY'
import pathlib
import sys
import tomllib

with pathlib.Path(sys.argv[1]).open("rb") as source:
    print(tomllib.load(source)["workspace"]["package"]["version"])
PY
)

echo "Current version: $CURRENT_VERSION"

if ! BUMPED_TAG=$(git-cliff --bumped-version); then
    echo "git-cliff could not compute the next version" >&2
    exit 1
fi
BUMPED_TAG=${BUMPED_TAG//$'\n'/}

if [[ ! "$BUMPED_TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$ ]]; then
    echo "git-cliff returned an invalid release tag: $BUMPED_TAG" >&2
    exit 1
fi
NEXT_VERSION="${BASH_REMATCH[1]}"

if [[ "$NEXT_VERSION" == "$CURRENT_VERSION" ]]; then
    echo "No version bump is required"
    exit 0
fi

echo "Bumping workspace: $CURRENT_VERSION -> $NEXT_VERSION"
cargo set-version --workspace "$NEXT_VERSION"
./scripts/validate-release-version.sh "$NEXT_VERSION"

echo
printf 'Bumped the workspace to %s. Review Cargo.toml and Cargo.lock, then commit as chore(release): v%s.\n' "$NEXT_VERSION" "$NEXT_VERSION"
