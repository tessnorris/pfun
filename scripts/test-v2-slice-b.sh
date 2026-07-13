#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-a/stage3/pfc.js ]]; then
	BASE_COMPILER="output/slice-a/stage3/pfc.js"
else
	BASE_COMPILER="bootstrap-stage2/pfc.js"
fi

WORK="output/slice-b"
STAGE3="$WORK/stage3/pfc.js"
STAGE4="$WORK/stage4/pfc.js"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

if [[ ! -f lib/list.pf ]]; then
	echo "error: lib/list.pf is missing; install the V2 list facade first" >&2
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage3" "$WORK/stage4"

echo "== Build compiler containing Slice B changes =="
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE3"

echo
echo "== Compiler fixed point =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build bootstrap/src/drivers/cli.pf \
	-o "$STAGE4"

cmp "$STAGE3" "$STAGE4"
echo "compiler fixed point passed"

echo
echo "== Slice B positive Node bundle =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build bootstrap/spec/slice-b/main.pf \
	-o "$WORK/slice-b.js"

node "$WORK/slice-b.js" > "$WORK/slice-b.actual.txt"

diff -u \
	bootstrap/spec/slice-b/expected.txt \
	"$WORK/slice-b.actual.txt"

echo "Slice B positive program passed"

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
echo "== Slice B negative diagnostics =="

expect_build_failure \
	"literal-zero-divisor" \
	"bootstrap/spec/slice-b/literal_zero_divisor.pf" \
	"Literal 0 is not a valid Int divisor." \
	"match nonZero(y)" \
	"safeDiv(x, y)" \
	"inline a nonzero integer literal"

expect_build_failure \
	"variable-divisor" \
	"bootstrap/spec/slice-b/variable_divisor.pf" \
	"requires a NonZero divisor" \
	"match nonZero(y)" \
	"safeDiv(x, y)" \
	"inline a nonzero integer literal"

expect_build_failure \
	"variable-modulus" \
	"bootstrap/spec/slice-b/variable_modulus.pf" \
	"requires a NonZero divisor" \
	"safeMod(x, y)"

expect_build_failure \
	"partial-nth" \
	"bootstrap/spec/slice-b/partial_nth.pf" \
	"requires numeric operands"

expect_build_failure \
	"partial-index" \
	"bootstrap/spec/slice-b/partial_index.pf" \
	"requires numeric operands"

expect_build_failure \
	"partial-chr" \
	"bootstrap/spec/slice-b/partial_chr.pf" \
	"Expected Option<Char>, got Char."

expect_build_failure \
	"partial-head" \
	"bootstrap/spec/slice-b/partial_head.pf" \
	"requires numeric operands"

if [[ -x scripts/test-v2-slice-a.sh ]]; then
	echo
	echo "== Slice A regression gate =="
	bash scripts/test-v2-slice-a.sh "$STAGE3"
fi

echo
echo "ALL SLICE B1 ACCEPTANCE TESTS PASSED"
