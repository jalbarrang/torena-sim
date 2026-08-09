#!/usr/bin/env bash
# Run the local Rust quality gates from any directory in the repository.
# Usage:
#   ./scripts/quality-gates.sh
#   ./scripts/quality-gates.sh --quick

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

run_gate "Rustfmt" cargo fmt --check

if [[ "$QUICK" == false ]] && command -v cargo-deny &>/dev/null; then
    run_gate "cargo-deny" cargo deny check
elif [[ "$QUICK" == false ]]; then
    echo -e "\n  ${YELLOW}⚠ SKIP: cargo-deny not installed (cargo install cargo-deny)${NC}"
fi

if [[ "$QUICK" == false ]] && command -v cargo-machete &>/dev/null; then
    run_gate "cargo-machete" cargo machete
elif [[ "$QUICK" == false ]]; then
    echo -e "\n  ${YELLOW}⚠ SKIP: cargo-machete not installed (cargo install cargo-machete)${NC}"
fi

run_gate "Clippy (zero warnings)" cargo clippy --locked --workspace --all-targets -- -D warnings
run_gate "Rustdoc (zero warnings)" env RUSTDOCFLAGS=-Dwarnings cargo doc --locked -p honse-sim --no-deps
run_gate "Tests" cargo test --locked --workspace

if [[ "$QUICK" == false ]]; then
    run_gate "Cargo check (native)" cargo check --locked --workspace --all-targets

    WASM_PROBE_DIR=$(mktemp -d)
    if echo 'pub fn _probe() {}' | rustc --target wasm32-unknown-unknown --crate-type lib --emit metadata -o "$WASM_PROBE_DIR/probe.rmeta" - 2>/dev/null; then
        run_gate "Cargo build (wasm32)" cargo build --locked -p honse-sim-wasm --target wasm32-unknown-unknown
    else
        echo -e "\n  ${YELLOW}⚠ SKIP: wasm32-unknown-unknown is not available for the active toolchain.${NC}"
        echo -e "  ${YELLOW}  Run: rustup target add wasm32-unknown-unknown${NC}"
    fi
    rm -rf "$WASM_PROBE_DIR"
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
echo -e "  ${GREEN}✓ All gates passed.${NC}"
echo ""
