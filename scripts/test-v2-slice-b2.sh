#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-b2"
RUNTIME_ROOT="$ROOT/$WORK/runtime-root"
STAGE3="$WORK/stage3/pfc.js"
STAGE4="$WORK/stage4/pfc.js"


cleanup() {
	rm -rf "$RUNTIME_ROOT"
}
trap cleanup EXIT

rm -rf "$WORK"
mkdir -p "$WORK/stage3" "$WORK/stage4"

echo "== Build compiler containing Slice B2 changes =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE3"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build src/drivers/cli.pf \
	-o "$STAGE4"

cmp "$STAGE3" "$STAGE4"
echo "compiler fixed point passed"

echo
echo "== Slice B2 file-effects Node bundle =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build spec/slice-b2/main.pf \
	-o "$WORK/slice-b2.js"

rm -rf "$RUNTIME_ROOT"

PFUN_SLICE_B2_TOKEN="present" \
	node "$WORK/slice-b2.js" "$RUNTIME_ROOT" \
	> "$WORK/slice-b2.actual.txt"

diff -u \
	spec/slice-b2/expected.txt \
	"$WORK/slice-b2.actual.txt"

if [[ ! -f "$RUNTIME_ROOT/nested/sample.txt" ]]; then
	echo "error: Slice B2 program did not create the expected file" >&2
	exit 1
fi

if [[ "$(cat "$RUNTIME_ROOT/nested/sample.txt")" != "Hello from B2!" ]]; then
	echo "error: Slice B2 file contents were incorrect" >&2
	exit 1
fi

echo "Slice B2 file-effects program passed"

echo
echo "== Slice B2 no-argument Node bundle =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build spec/slice-b2/no_args.pf \
	-o "$WORK/no-args.js"

node "$WORK/no-args.js" > "$WORK/no-args.actual.txt"

diff -u \
	spec/slice-b2/no_args.expected.txt \
	"$WORK/no-args.actual.txt"

echo "Slice B2 no-argument program passed"

expect_build_failure() {
	local name="$1"
	local source="$2"
	shift 2

	local log="$WORK/${name}.log"
	local output="$WORK/${name}.js"

	if PFUN_HOME="$ROOT" node "$STAGE3" \
		build "$source" \
		-o "$output" \
		> "$log" 2>&1
	then
		echo "error: $name unexpectedly compiled" >&2
		cat "$log" >&2
		exit 1
	fi

	for needle in "$@"; do
		if ! grep -F -- "$needle" "$log" > /dev/null; then
			echo "error: $name did not contain expected diagnostic:" >&2
			echo "  $needle" >&2
			echo "--- compiler output ---" >&2
			cat "$log" >&2
			exit 1
		fi
	done

	echo "$name passed"
}

echo
echo "== Slice B2 negative diagnostics =="

expect_build_failure \
	"pure-read-file" \
	"spec/slice-b2/pure_read_file.pf" \
	"Pure code cannot call procedure 'readFile'."

expect_build_failure \
	"pure-file-exists" \
	"spec/slice-b2/pure_file_exists.pf" \
	"Pure code cannot call procedure 'fileExists'."

expect_build_failure \
	"write-content-type" \
	"spec/slice-b2/write_content_type.pf" \
	"Str" \
	"Int"


echo
echo "ALL SLICE B2 ACCEPTANCE TESTS PASSED"
