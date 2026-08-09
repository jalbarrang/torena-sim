#!/usr/bin/env bash
# Check registry state and verify any existing exact-version artifacts.

set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "Usage: $0 <version> <crate-archive> <npm-archive>" >&2
    exit 2
fi

VERSION="$1"
CRATE_ARCHIVE="$2"
NPM_ARCHIVE="$3"
USER_AGENT="honse-sim-release-workflow/0.1 (https://github.com/jalbarrang/torena-sim)"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

for archive in "$CRATE_ARCHIVE" "$NPM_ARCHIVE"; do
    if [[ ! -f "$archive" ]]; then
        echo "Release archive does not exist: $archive" >&2
        exit 1
    fi
done

request() {
    local url="$1"
    local output="$2"
    curl --silent --show-error --location --user-agent "$USER_AGENT" --output "$output" --write-out '%{http_code}' "$url"
}

emit() {
    local key="$1"
    local value="$2"
    echo "$key=$value"
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        echo "$key=$value" >> "$GITHUB_OUTPUT"
    fi
}

crate_any_code=$(request "https://crates.io/api/v1/crates/honse-sim" "$TEMP_DIR/crate-any.json")
case "$crate_any_code" in
    200) crate_exists_any=true ;;
    404) crate_exists_any=false ;;
    *) echo "crates.io name lookup failed with HTTP $crate_any_code" >&2; exit 1 ;;
esac

crate_exact_code=$(request "https://crates.io/api/v1/crates/honse-sim/$VERSION" "$TEMP_DIR/crate-exact.json")
case "$crate_exact_code" in
    200)
        crate_exists_exact=true
        remote_checksum=$(python3 - "$TEMP_DIR/crate-exact.json" <<'PY'
import json
import pathlib
import sys

print(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["version"]["checksum"])
PY
)
        local_checksum=$(python3 - "$CRATE_ARCHIVE" <<'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)
        if [[ "$local_checksum" != "$remote_checksum" ]]; then
            echo "Existing crates.io archive does not match the local archive" >&2
            exit 1
        fi
        ;;
    404) crate_exists_exact=false ;;
    *) echo "crates.io version lookup failed with HTTP $crate_exact_code" >&2; exit 1 ;;
esac

npm_exact_code=$(request "https://registry.npmjs.org/honse-sim/$VERSION" "$TEMP_DIR/npm-exact.json")
case "$npm_exact_code" in
    200)
        npm_exists_exact=true
        remote_integrity=$(python3 - "$TEMP_DIR/npm-exact.json" <<'PY'
import json
import pathlib
import sys

print(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["dist"]["integrity"])
PY
)
        local_integrity=$(python3 - "$NPM_ARCHIVE" <<'PY'
import base64
import hashlib
import pathlib
import sys

digest = hashlib.sha512(pathlib.Path(sys.argv[1]).read_bytes()).digest()
print("sha512-" + base64.b64encode(digest).decode("ascii"))
PY
)
        if [[ "$local_integrity" != "$remote_integrity" ]]; then
            echo "Existing npm archive does not match the local archive" >&2
            exit 1
        fi
        ;;
    404) npm_exists_exact=false ;;
    *) echo "npm version lookup failed with HTTP $npm_exact_code" >&2; exit 1 ;;
esac

emit crate_exists_any "$crate_exists_any"
emit crate_exists_exact "$crate_exists_exact"
emit npm_exists_exact "$npm_exists_exact"
