#!/usr/bin/env bash
# =============================================================================
# Local quality gate script — mirrors the Rust CI pipeline.
# Run from the `packages/` directory before pushing.
#
# Usage:
#   ./scripts/quality-gates.sh            # full check
#   ./scripts/quality-gates.sh --quick    # fmt + clippy + tests only
# =============================================================================

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

QUICK=false
[[ "${1:-}" == "--quick" ]] && QUICK=true

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[0;33m'; NC='\033[0m'
FAILED=()

run_gate() {
    local name="$1"; shift
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $name${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if "$@"; then
        echo -e "  ${GREEN}✓ PASSED: $name${NC}"
    else
        echo -e "  ${RED}✗ FAILED: $name${NC}"
        FAILED+=("$name")
    fi
}

START=$(date +%s)

# Gate 1: Formatting
run_gate "Rustfmt" cargo fmt --check

# Gate 2: Supply chain
if [[ "$QUICK" == false ]] && command -v cargo-deny &>/dev/null; then
    run_gate "cargo-deny" cargo deny check
elif [[ "$QUICK" == false ]]; then
    echo -e "\n  ${YELLOW}⚠ SKIP: cargo-deny not installed (cargo install cargo-deny)${NC}"
fi

# Gate 3: Unused deps
if [[ "$QUICK" == false ]] && command -v cargo-machete &>/dev/null; then
    run_gate "cargo-machete" cargo machete
elif [[ "$QUICK" == false ]]; then
    echo -e "\n  ${YELLOW}⚠ SKIP: cargo-machete not installed (cargo install cargo-machete)${NC}"
fi

# Gate 4: Clippy (zero warnings)
run_gate "Clippy (zero warnings)" cargo clippy --workspace --all-targets -- -D warnings

# Gate 5: Tests
run_gate "Tests" cargo test --workspace --lib

# Gate 6: Type check (native) + WASM build
if [[ "$QUICK" == false ]]; then
    run_gate "Cargo check (native)" cargo check --workspace --all-targets

    # The WASM build needs the wasm32-unknown-unknown std. Probe for it; if the
    # active toolchain lacks it (e.g. a standalone, non-rustup install), skip
    # with guidance rather than failing the whole run.
    if echo 'pub fn _probe() {}' | rustc --target wasm32-unknown-unknown --crate-type lib --emit metadata -o /dev/null - 2>/dev/null; then
        run_gate "Cargo build (wasm32)" cargo build -p uma-sim-wasm --target wasm32-unknown-unknown
    else
        echo -e "\n  ${YELLOW}⚠ SKIP: wasm32-unknown-unknown std not available for the active toolchain.${NC}"
        echo -e "  ${YELLOW}  Enable it with a rustup toolchain: rustup target add wasm32-unknown-unknown${NC}"
        echo -e "  ${YELLOW}  (CI builds the WASM target on every run regardless.)${NC}"
    fi
fi

END=$(date +%s); ELAPSED=$((END - START))
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Quality Gates Complete (${ELAPSED}s)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ ${#FAILED[@]} -gt 0 ]]; then
    echo ""
    echo -e "  ${RED}✗ ${#FAILED[@]} gate(s) FAILED:${NC}"
    for f in "${FAILED[@]}"; do echo -e "    ${RED}- $f${NC}"; done
    echo ""
    exit 1
fi
echo ""
echo -e "  ${GREEN}✓ All gates passed — safe to push.${NC}"
echo ""
