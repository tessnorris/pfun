#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-e4-pipeline-operators"
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
	error_line "Slice E4 requires the coreutils 'timeout' command"
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

section "Build compiler containing Slice E4"
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

section "Complete generated test suite under the E4 compiler"
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

section "Pipeline host ABI"
node test/host_core_abi_test.js
pass_line "Option and Result pipeline helpers map, flatten, and short-circuit"

section "Transparent pipeline behavior through pfc run"
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e4-pipeline-operators/main.pf
timeout 10 env PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-e4-pipeline-operators/main.pf \
	> "$WORK/run.stdout.txt" \
	2> "$WORK/run.stderr.txt"
if [[ -s "$WORK/run.stderr.txt" ]]; then
	error_line "successful pipeline fixture wrote stderr"
	cat "$WORK/run.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e4-pipeline-operators/expected.txt \
	"$WORK/run.stdout.txt"
pass_line "raw starts, mapping, flattening, short-circuiting, and error joins"

section "Direct NodeBundle pipeline behavior"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-e4-pipeline-operators/main.pf \
	-o "$WORK/main.js"
timeout 10 node "$WORK/main.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"
if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	error_line "successful pipeline NodeBundle wrote stderr"
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e4-pipeline-operators/expected.txt \
	"$WORK/bundle.stdout.txt"
if ! grep -F 'const some = $optionPipe' "$WORK/main.js" >/dev/null; then
	error_line "NodeBundle did not lower wrapped Option pipelines"
	exit 1
fi
if ! grep -F 'const transformed = $resultPipe' "$WORK/main.js" >/dev/null; then
	error_line "NodeBundle did not lower wrapped Result pipelines"
	exit 1
fi
pass_line "direct bundle uses the checked wrapper pipeline ABI"

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

section "Static pipeline contracts"
run_check_negative \
	spec/slice-e4-pipeline-operators/bad-arity.pf \
	Type \
	"exactly one argument"
run_check_negative \
	spec/slice-e4-pipeline-operators/pure-proc-call.pf \
	Purity \
	"Pure code cannot call procedure"

section "Canonical modular example"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build examples/example.pf \
	-o "$WORK/example.js"
timeout 10 node "$WORK/example.js" \
	> "$WORK/example.stdout.txt" \
	2> "$WORK/example.stderr.txt"
if [[ -s "$WORK/example.stderr.txt" ]]; then
	error_line "canonical example wrote stderr"
	cat "$WORK/example.stderr.txt" >&2
	exit 1
fi
diff -u examples/example.expected.txt "$WORK/example.stdout.txt"
pass_line "manual-facing examples include all three pipelines"

printf "\n%sALL SLICE E4 PIPELINE-OPERATOR TESTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"
