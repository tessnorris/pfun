#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-b4/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-b4/stage1/pfc.js"
elif [[ -f output/slice-b3/stage4/pfc.js ]]; then
	BASE_COMPILER="output/slice-b3/stage4/pfc.js"
else
	BASE_COMPILER="bootstrap-stage2/pfc.js"
fi

WORK="output/slice-b5"
RUNTIME_ROOT="$ROOT/$WORK/runtime-root"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

cleanup() {
	rm -rf "$RUNTIME_ROOT"
}
trap cleanup EXIT

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2"

echo "== Build compiler used for Slice B5 =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE1"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE2"

cmp "$STAGE1" "$STAGE2"
echo "compiler fixed point passed"

echo
echo "== Slice B5 TOML Node bundle =="

PFUN_HOME="$ROOT" node "$STAGE1" \
	build bootstrap/spec/slice-b5/main.pf \
	-o "$WORK/slice-b5.js"

rm -rf "$RUNTIME_ROOT"

timeout 15s node "$WORK/slice-b5.js" "$RUNTIME_ROOT" \
	> "$WORK/slice-b5.actual.txt"

diff -u \
	bootstrap/spec/slice-b5/expected.txt \
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

if [[ -x scripts/test-v2-slice-b4.sh ]]; then
	echo
	echo "== B4, B3, B2, B1, and Slice A regression gates =="
	bash scripts/test-v2-slice-b4.sh "$STAGE1"
fi

echo
echo "ALL SLICE B5 ACCEPTANCE TESTS PASSED"
