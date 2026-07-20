#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-a"
STAGE3="$WORK/stage3/pfc.js"
STAGE4="$WORK/stage4/pfc.js"


rm -rf "$WORK"
mkdir -p "$WORK/stage3" "$WORK/stage4"

echo "== Build compiler containing Slice A changes =="
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
echo "== Slice A positive Node bundle =="
PFUN_HOME="$ROOT" node "$STAGE3" \
	build spec/slice-a/main.pf \
	-o "$WORK/slice-a.js"

node "$WORK/slice-a.js" > "$WORK/slice-a.actual.txt"

diff -u \
	spec/slice-a/expected.txt \
	"$WORK/slice-a.actual.txt"

echo "Slice A positive program passed"

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
echo "== Slice A negative diagnostics =="

expect_build_failure \
	"exact-arity-too-few" \
	"spec/slice-a/exact_arity_too_few.pf" \
	"Call expected 2 argument(s), got 1."

expect_build_failure \
	"exact-arity-too-many" \
	"spec/slice-a/exact_arity_too_many.pf" \
	"Call expected 2 argument(s), got 3."

expect_build_failure \
	"guarded-only-match" \
	"spec/slice-a/guarded_only_match.pf" \
	"Non-exhaustive match on 'SliceGuarded'" \
	"missing unguarded arm(s)" \
	"SliceGuardA"

expect_build_failure \
	"pure-calls-proc" \
	"spec/slice-a/pure_calls_proc.pf" \
	"Pure code cannot call procedure 'importedAnnounce'."

if [[ -f examples/example-V2.pf && -f examples/example-V2.expected.txt ]]; then
	echo
	echo "== Modular example-V2 acceptance =="
	PFUN_HOME="$ROOT" node "$STAGE3" \
		build examples/example-V2.pf \
		-o "$WORK/example-V2.js"

	node "$WORK/example-V2.js" > "$WORK/example-V2.actual.txt"

	diff -u \
		examples/example-V2.expected.txt \
		"$WORK/example-V2.actual.txt"

	echo "example-V2 acceptance passed"
fi

echo
echo "ALL SLICE A ACCEPTANCE TESTS PASSED"
