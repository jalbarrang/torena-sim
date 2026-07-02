#!/usr/bin/env bash
# =============================================================================
# Install a git pre-commit hook that runs quick Rust quality gates whenever
# staged changes touch the packages/ Rust workspace.
# Run once: packages/scripts/install-hooks.sh
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_FILE="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK_FILE" << 'HOOK'
#!/usr/bin/env bash
# Pre-commit hook: quick Rust quality gates for the packages/ workspace.
# Installed by packages/scripts/install-hooks.sh
# To skip: git commit --no-verify
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGED_RS=$(git diff --cached --name-only --diff-filter=ACM | grep '^packages/.*\.rs$' || true)

if [[ -z "$STAGED_RS" ]]; then
    exit 0
fi

echo "🔍 Running pre-commit Rust quality gates..."
cd "$REPO_ROOT/packages" || exit 1

echo "  → rustfmt..."
if ! cargo fmt --check; then
    echo "❌ Format check failed. Run: (cd packages && cargo fmt)"
    exit 1
fi

echo "  → clippy (zero warnings)..."
if ! cargo clippy --workspace --all-targets -- -D warnings; then
    echo "❌ Clippy failed. Fix warnings before committing."
    exit 1
fi

echo "✅ Pre-commit checks passed."
HOOK

chmod +x "$HOOK_FILE"
echo "✅ Pre-commit hook installed at $HOOK_FILE"
echo ""
echo "Optional: install the full quality toolset:"
echo "  cargo install cargo-deny cargo-machete"
