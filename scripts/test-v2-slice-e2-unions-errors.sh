#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-e2-unions-errors"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"

color_enabled=0
if [[ -n "${FORCE_COLOR:-}" && "${FORCE_COLOR:-0}" != "0" ]]; then
	color_enabled=1
	unset NO_COLOR
elif [[ -t 1 && -z "${NO_COLOR+x}" && "${TERM:-}" != "dumb" ]]; then
	color_enabled=1
fi

if [[ "$color_enabled" -eq 1 ]]; then
	RED=$'\033[31m'
	GREEN=$'\033[32m'
	CYAN=$'\033[36m'
	BOLD_RED=$'\033[1;31m'
	BOLD_GREEN=$'\033[1;32m'
	RESET=$'\033[0m'
else
	RED=''
	GREEN=''
	CYAN=''
	BOLD_RED=''
	BOLD_GREEN=''
	RESET=''
fi

CURRENT_STAGE="initialization"

section() {
	CURRENT_STAGE="$1"
	printf "\n%s== %s ==%s\n" "$CYAN" "$1" "$RESET"
}

pass_line() {
	printf "%sPASS%s -- %s\n" "$GREEN" "$RESET" "$1"
}

fail_line() {
	printf "%sFAIL%s -- %s\n" "$BOLD_RED" "$RESET" "$1" >&2
}

error_line() {
	printf "%serror:%s %s\n" "$RED" "$RESET" "$1" >&2
}

unexpected_failure() {
	local rc="$1"
	trap - ERR
	printf "\n%sFAIL%s -- %s (exit %s)\n" \
		"$BOLD_RED" "$RESET" "$CURRENT_STAGE" "$rc" >&2
	exit "$rc"
}

trap 'unexpected_failure $?' ERR

if [[ ! -f "$BASE_COMPILER" ]]; then
	error_line "compiler not found: $BASE_COMPILER"
	exit 1
fi

if ! command -v timeout >/dev/null 2>&1; then
	error_line "Slice E2 requires the coreutils 'timeout' command"
	exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2" "$WORK/tests"

section "Regenerate generated harness"
node utils/gen-test-harness.js \
	--dir test \
	--runner-import 'import * from "../src/test/runner";' \
	--orchestrate test/run-tests.sh \
	--mode compile \
	--pfun 'node boot/pfc.js' \
	--timeout 90

section "Build compiler containing Slice E2"
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE1"

section "Compiler fixed point"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build src/drivers/cli.pf \
	-o "$STAGE2"
cmp "$STAGE1" "$STAGE2"
pass_line "compiler generations 1 and 2 are byte-identical"
sha256sum "$STAGE1"

section "Complete generated test suite under the E2 compiler"
pass=0
for source in test/*_test_gen.pf; do
	CURRENT_STAGE="generated test: $source"
	base="$(basename "$source" .pf)"
	js="$WORK/tests/$base.js"
	log="$WORK/tests/$base.log"
	if PFUN_HOME="$ROOT" node "$STAGE1" build "$source" -o "$js" >"$log" 2>&1 \
		&& timeout 90 node "$js" >>"$log" 2>&1
	then
		pass=$((pass + 1))
		pass_line "$source"
	else
		fail_line "$source"
		cat "$log" >&2
		exit 1
	fi
done
pass_line "$pass generated test files passed"

section "Cross-module combined Result errors"
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e2-unions-errors/main.pf
timeout 10 env PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-e2-unions-errors/main.pf \
	> "$WORK/run.stdout.txt" \
	2> "$WORK/run.stderr.txt"
if [[ -s "$WORK/run.stderr.txt" ]]; then
	error_line "successful combined-union fixture wrote stderr"
	cat "$WORK/run.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e2-unions-errors/expected.txt \
	"$WORK/run.stdout.txt"
pass_line "cross-module, transitive, shared-field, and Result behavior"

section "Direct NodeBundle behavior"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-e2-unions-errors/main.pf \
	-o "$WORK/main.js"
timeout 10 node "$WORK/main.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"
if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	error_line "successful combined-union bundle wrote stderr"
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e2-unions-errors/expected.txt \
	"$WORK/bundle.stdout.txt"
pass_line "included constructors retain their original runtime owners"

run_check_negative() {
	local fixture="$1"
	local category="$2"
	local needle="$3"
	local name
	name="$(basename "$fixture" .pf)"
	local log="$WORK/$name.check.txt"
	CURRENT_STAGE="negative check: $fixture"

	if PFUN_HOME="$ROOT" node "$STAGE1" check "$fixture" >"$log" 2>&1; then
		error_line "negative fixture unexpectedly checked: $fixture"
		exit 1
	fi
	if ! grep -F "error[$category]" "$log" >/dev/null; then
		error_line "$fixture did not emit error[$category]"
		cat "$log" >&2
		exit 1
	fi
	if ! grep -F "$needle" "$log" >/dev/null; then
		error_line "$fixture diagnostic lacked: $needle"
		cat "$log" >&2
		exit 1
	fi
	pass_line "$fixture"
}

section "Static inclusion contracts"
run_check_negative \
	spec/slice-e2-unions-errors/missing-included-arm.pf \
	Exhaust \
	"JsonInvalid"
run_check_negative \
	spec/slice-e2-unions-errors/missing-shared-field.pf \
	Type \
	"no field 'message'"
run_check_negative \
	spec/slice-e2-unions-errors/duplicate-variant.pf \
	Type \
	"duplicate variant 'SameProblem'"
run_check_negative \
	spec/slice-e2-unions-errors/cyclic-inclusion.pf \
	Type \
	"Cyclic union inclusion"
run_check_negative \
	spec/slice-e2-unions-errors/unknown-inclusion.pf \
	Type \
	"Unknown included union 'MissingError'"
run_check_negative \
	spec/slice-e2-unions-errors/include-record.pf \
	Type \
	"is not a union"
run_check_negative \
	spec/slice-e2-unions-errors/duplicate-inclusion.pf \
	Type \
	"more than once"
run_check_negative \
	spec/slice-e2-unions-errors/reverse-flow.pf \
	Type \
	"CombinedError with FirstError"
run_check_negative \
	spec/slice-e2-unions-errors/ambiguous-join.pf \
	Type \
	"Ambiguous combined-union join"

printf "\n%sALL SLICE E2 COMBINED-UNION/ERROR TESTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"
