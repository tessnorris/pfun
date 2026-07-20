#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-b3"
RUNTIME_ROOT="$ROOT/$WORK/runtime-root"
STAGE3="$WORK/stage3/pfc.js"
STAGE4="$WORK/stage4/pfc.js"
STAGE5="$WORK/stage5/pfc.js"


cleanup() {
	rm -rf "$RUNTIME_ROOT"
}
trap cleanup EXIT

rm -rf "$WORK"
mkdir -p "$WORK/stage3" "$WORK/stage4" "$WORK/stage5"

echo "== Build transitional compiler containing Slice B3 changes =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE3"

echo
echo "== Rebuild with the new emitter/linker =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build src/drivers/cli.pf \
	-o "$STAGE4"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE4" \
	build src/drivers/cli.pf \
	-o "$STAGE5"

cmp "$STAGE4" "$STAGE5"
TEST_COMPILER="$STAGE4"
echo "compiler fixed point passed (stage4 == stage5)"

echo
echo "== Slice B3 JSON Node bundle =="
PFUN_HOME="$ROOT" node "$TEST_COMPILER" \
	build spec/slice-b3/main.pf \
	-o "$WORK/slice-b3.js"

rm -rf "$RUNTIME_ROOT"

node "$WORK/slice-b3.js" "$RUNTIME_ROOT" \
	> "$WORK/slice-b3.actual.txt"

diff -u \
	spec/slice-b3/expected.txt \
	"$WORK/slice-b3.actual.txt"

JSON_FILE="$RUNTIME_ROOT/person.json"
if [[ ! -f "$JSON_FILE" ]]; then
	echo "error: B3 did not create its JSON round-trip file" >&2
	exit 1
fi

if ! grep -F '"__type":"B3Person"' "$JSON_FILE" > /dev/null; then
	echo "error: B3 JSON file did not preserve the nominal record tag" >&2
	exit 1
fi

echo "Slice B3 positive program passed"

echo
echo "== Slice B3 negative diagnostics =="

LOG="$WORK/partial-deserialize.log"
if PFUN_HOME="$ROOT" node "$TEST_COMPILER" \
	build spec/slice-b3/partial_deserialize.pf \
	-o "$WORK/partial-deserialize.js" \
	> "$LOG" 2>&1
then
	echo "error: partial JSON deserialize unexpectedly compiled" >&2
	cat "$LOG" >&2
	exit 1
fi

if ! grep -F "requires numeric operands" "$LOG" > /dev/null; then
	echo "error: partial JSON diagnostic was unexpected" >&2
	cat "$LOG" >&2
	exit 1
fi

echo "partial-deserialize passed"


echo
echo "ALL SLICE B3 ACCEPTANCE TESTS PASSED"
