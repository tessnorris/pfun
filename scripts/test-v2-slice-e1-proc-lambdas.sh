#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-e1-proc-lambdas"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"
STAGE3="$WORK/stage3/pfc.js"

# Match the generated test runner's color contract: FORCE_COLOR overrides
# NO_COLOR, and redirected output stays plain unless color is explicitly forced.
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

rm -rf "$WORK"
mkdir -p "$WORK/stage1" "$WORK/stage2" "$WORK/stage3" "$WORK/tests"

section "Regenerate generated harness"
node utils/gen-test-harness.js \
	--dir test \
	--runner-import 'import * from "../src/test/runner";' \
	--orchestrate test/run-tests.sh \
	--mode compile \
	--pfun 'node boot/pfc.js' \
	--timeout 90

section "Build compiler generation 1"
PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build src/drivers/cli.pf \
	-o "$STAGE1"

section "Build compiler generation 2"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build src/drivers/cli.pf \
	-o "$STAGE2"

section "Build compiler generation 3"
PFUN_HOME="$ROOT" node "$STAGE2" \
	build src/drivers/cli.pf \
	-o "$STAGE3"

cmp "$STAGE2" "$STAGE3"
pass_line "compiler generations 2 and 3 are byte-identical"
sha256sum "$STAGE2"

section "Complete generated test suite under generation 2"
pass=0
for source in test/*_test_gen.pf; do
	CURRENT_STAGE="generated test: $source"
	base="$(basename "$source" .pf)"
	js="$WORK/tests/$base.js"
	log="$WORK/tests/$base.log"
	if PFUN_HOME="$ROOT" node "$STAGE2" build "$source" -o "$js" >"$log" 2>&1 \
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

section "Proc-lambda positive integration"
PFUN_HOME="$ROOT" node "$STAGE2" \
	build spec/slice-e1-proc-lambdas/main.pf \
	-o "$WORK/main.js"
node "$WORK/main.js" > "$WORK/main.actual.txt"
diff -u \
	spec/slice-e1-proc-lambdas/expected.txt \
	"$WORK/main.actual.txt"
pass_line "transport, capture, import/export, sync, and async behavior"

run_negative() {
	local fixture="$1"
	local category="$2"
	local needle="$3"
	local name
	name="$(basename "$fixture" .pf)"
	local log="$WORK/$name.diag.txt"
	CURRENT_STAGE="negative contract: $fixture"

	local rc
	if PFUN_HOME="$ROOT" node "$STAGE2" check "$fixture" >"$log" 2>&1; then
		rc=0
	else
		rc=$?
	fi

	if [[ "$rc" -eq 0 ]]; then
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

section "Proc-lambda negative contracts"
run_negative \
	spec/slice-e1-proc-lambdas/pure-invoke.pf \
	Purity \
	"Pure code cannot call procedure"
run_negative \
	spec/slice-e1-proc-lambdas/async-mismatch.pf \
	Type \
	"Cannot unify async and non-async procedures"
run_negative \
	spec/slice-e1-proc-lambdas/arity-mismatch.pf \
	Type \
	"Call expected 1 argument(s), got 0"

section "Canonical V2 example"
PFUN_HOME="$ROOT" node "$STAGE2" \
	build examples/example.pf \
	-o "$WORK/example.js"
node "$WORK/example.js" > "$WORK/example.actual.txt"
diff -u examples/example.expected.txt "$WORK/example.actual.txt"
pass_line "canonical example output"

printf "\n%sALL SLICE E1 PROC-LAMBDA TESTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"
