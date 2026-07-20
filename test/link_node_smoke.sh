#!/usr/bin/env bash
# Phase 14 representative registry behavior test.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

node --check test/golden/link_representative.js

actual="$(node test/golden/link_representative.js)"
if [ "$actual" != "link-cache-ok" ]; then
  printf 'expected link-cache-ok, got %s\n' "$actual" >&2
  exit 1
fi

printf 'Phase 14 registry cache smoke test passed.\n'
