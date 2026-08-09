#!/usr/bin/env bash
# Validate that a manual release version matches every workspace artifact.

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <version>" >&2
    exit 2
fi

VERSION="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
if [[ ! "$VERSION" =~ $SEMVER_RE ]]; then
    echo "Release version must be SemVer without a v prefix or build metadata: $VERSION" >&2
    exit 1
fi

python3 - "$REPO_ROOT" "$VERSION" <<'PY'
import json
import pathlib
import subprocess
import sys
import tomllib

root = pathlib.Path(sys.argv[1])
expected = sys.argv[2]
with (root / "Cargo.toml").open("rb") as source:
    workspace_version = tomllib.load(source)["workspace"]["package"]["version"]
if workspace_version != expected:
    raise SystemExit(f"workspace version {workspace_version} does not match release input {expected}")

metadata = json.loads(subprocess.check_output([
    "cargo", "metadata", "--no-deps", "--format-version", "1"
], cwd=root, text=True))
versions = {package["name"]: package["version"] for package in metadata["packages"]}
expected_packages = {"honse-sim", "honse-sim-wasm"}
if set(versions) != expected_packages:
    raise SystemExit(f"workspace packages {sorted(versions)} do not match {sorted(expected_packages)}")
for name, version in versions.items():
    if version != expected:
        raise SystemExit(f"{name} version {version} does not match release input {expected}")

publish = {package["name"]: package.get("publish") for package in metadata["packages"]}
if publish["honse-sim"] != ["crates-io"]:
    raise SystemExit("honse-sim must publish only to crates-io")
if publish["honse-sim-wasm"] != []:
    raise SystemExit("honse-sim-wasm must keep publish = false")
PY

echo "Release version $VERSION matches all workspace artifacts"
