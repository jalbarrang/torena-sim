#!/usr/bin/env bash
# Build and normalize the honse-sim npm package.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_CRATE="$REPO_ROOT/honse-sim-wasm"
PACKAGE_DIR="$WASM_CRATE/pkg"

if [[ "$(wasm-pack --version)" != "wasm-pack 0.15.0" ]]; then
    echo "wasm-pack 0.15.0 is required" >&2
    exit 1
fi

LOCK_BEFORE=$(python3 - "$REPO_ROOT/Cargo.lock" <<'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)

VERSION=$(python3 - "$REPO_ROOT/Cargo.toml" <<'PY'
import pathlib
import sys
import tomllib

manifest = pathlib.Path(sys.argv[1])
with manifest.open("rb") as source:
    print(tomllib.load(source)["workspace"]["package"]["version"])
PY
)

rm -rf "$PACKAGE_DIR"
wasm-pack build "$WASM_CRATE" --target web --out-dir pkg --out-name uma_sim_wasm

LOCK_AFTER=$(python3 - "$REPO_ROOT/Cargo.lock" <<'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)
if [[ "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
    echo "wasm-pack changed Cargo.lock" >&2
    exit 1
fi

python3 - "$PACKAGE_DIR/package.json" "$VERSION" <<'PY'
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
version = sys.argv[2]
manifest = {
    "name": "honse-sim",
    "type": "module",
    "description": "WebAssembly adapter for the honse-sim race simulation engine.",
    "version": version,
    "license": "GPL-3.0-only",
    "repository": {
        "type": "git",
        "url": "https://github.com/jalbarrang/torena-sim",
    },
    "files": [
        "uma_sim_wasm_bg.wasm",
        "uma_sim_wasm.js",
        "uma_sim_wasm.d.ts",
        "snippets",
    ],
    "main": "uma_sim_wasm.js",
    "types": "uma_sim_wasm.d.ts",
    "sideEffects": ["./snippets/*"],
}
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

cp "$REPO_ROOT/LICENSE" "$PACKAGE_DIR/LICENSE"

for asset in package.json LICENSE uma_sim_wasm_bg.wasm uma_sim_wasm.js uma_sim_wasm.d.ts; do
    if [[ ! -f "$PACKAGE_DIR/$asset" ]]; then
        echo "Missing npm package asset: $asset" >&2
        exit 1
    fi
done

python3 - "$PACKAGE_DIR/package.json" "$VERSION" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
expected_version = sys.argv[2]
if manifest["name"] != "honse-sim":
    raise SystemExit("npm package name must be honse-sim")
if manifest["version"] != expected_version:
    raise SystemExit(f"npm version {manifest['version']} does not match {expected_version}")
if manifest["license"] != "GPL-3.0-only":
    raise SystemExit("npm package license must be GPL-3.0-only")
PY

echo "Built honse-sim@$VERSION in $PACKAGE_DIR"
