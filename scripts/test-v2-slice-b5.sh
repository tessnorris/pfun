#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-b5"
RUNTIME_ROOT="$ROOT/$WORK/runtime-root"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

cleanup() {
	rm -rf "$RUNTIME_ROOT"
}
trap cleanup EXIT


rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler used for Slice B5 =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== Slice B5 TOML Node bundle =="

PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-b5/main.pf \
	-o "$WORK/slice-b5.js"

rm -rf "$RUNTIME_ROOT"

timeout 15s node "$WORK/slice-b5.js" "$RUNTIME_ROOT" \
	> "$WORK/slice-b5.actual.txt"

diff -u \
	spec/slice-b5/expected.txt \
	"$WORK/slice-b5.actual.txt"

TOML_FILE="$RUNTIME_ROOT/config.toml"

if [[ ! -f "$TOML_FILE" ]]; then
	echo "error: B5 did not create config.toml" >&2
	exit 1
fi

if ! grep -F 'title = "P#fun"' "$TOML_FILE" > /dev/null; then
	echo "error: B5 TOML file did not contain the expected title" >&2
	exit 1
fi

if ! grep -F '[server]' "$TOML_FILE" > /dev/null; then
	echo "error: B5 TOML file did not contain the expected section" >&2
	exit 1
fi

echo "Slice B5 TOML program passed"


echo
echo "ALL SLICE B5 ACCEPTANCE TESTS PASSED"
