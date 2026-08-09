#!/usr/bin/env bash
# Install a pre-commit hook that checks staged Rust workspace changes.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_FILE="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK_FILE" << 'HOOK'
#!/usr/bin/env bash
# Installed by scripts/install-hooks.sh.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGED_RUST=$(git diff --cached --name-only --diff-filter=ACM | grep -E '(^|/)(Cargo\.toml|Cargo\.lock|[^/]+\.rs)$|^(\.cargo/|rust-toolchain\.toml|rustfmt\.toml|clippy\.toml|deny\.toml)' || true)

if [[ -z "$STAGED_RUST" ]]; then
    exit 0
fi

cd "$REPO_ROOT" || exit 1

echo "Running pre-commit Rust checks..."

if ! cargo fmt --check; then
    echo "Format check failed. Run: cargo fmt"
    exit 1
fi

if ! cargo clippy --workspace --all-targets -- -D warnings; then
    echo "Clippy failed. Fix all warnings before you commit."
    exit 1
fi

echo "Pre-commit Rust checks passed."
HOOK

chmod +x "$HOOK_FILE"
echo "Pre-commit hook installed at $HOOK_FILE"
echo "Optional tools: cargo install cargo-deny cargo-machete"
