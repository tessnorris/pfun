#!/usr/bin/env bash
# Phase 13 golden output syntax and behavior smoke test.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

node --check bootstrap/test/golden/emit_representative.js

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

cat >"$tmp" <<'JS'
function $addI(a, b) { return a + b; }
function $strConcat(a, b) { return a + b; }
function $stringify(value) { return String(value); }
JS

cat bootstrap/test/golden/emit_representative.js >>"$tmp"
printf '\nconsole.log(message);\n' >>"$tmp"

actual="$(node "$tmp")"
if [ "$actual" != "answer=5" ]; then
  printf 'expected answer=5, got %s\n' "$actual" >&2
  exit 1
fi

printf 'Phase 13 golden JavaScript passed syntax and behavior smoke tests.\n'
