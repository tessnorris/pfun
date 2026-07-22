#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-e6-timer-results"
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
	error_line "Slice E6 requires the coreutils 'timeout' command"
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

section "Build compiler containing Slice E6"
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

section "Complete generated test suite under the E6 compiler"
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
		cat "$log" >&2
		exit 1
	fi
done
pass_line "$pass generated test files passed"

section "Async and timer host Result behavior"
node test/async_node_host_test.js
node test/timer_host_test.js
node test/host_core_abi_test.js
node test/host_node_test.js
node test/host_browser_test.js
pass_line "Node and browser hosts share the Result-returning timer floor"

section "Timer Results through pfc run"
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e6-timer-results/main.pf
timeout 10 env PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-e6-timer-results/main.pf \
	> "$WORK/run.stdout.txt" \
	2> "$WORK/run.stderr.txt"
if [[ -s "$WORK/run.stderr.txt" ]]; then
	error_line "successful timer Result fixture wrote stderr"
	cat "$WORK/run.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e6-timer-results/expected.txt \
	"$WORK/run.stdout.txt"
pass_line "sleep, scheduling, cancellation, and callbacks use Results"

section "Direct NodeBundle timer Result behavior"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-e6-timer-results/main.pf \
	-o "$WORK/main.js"
timeout 10 node "$WORK/main.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"
if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	error_line "successful timer Result NodeBundle wrote stderr"
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e6-timer-results/expected.txt \
	"$WORK/bundle.stdout.txt"
pass_line "direct bundle embeds the structured timer-error ABI"

section "Legacy bare TimerHandle contract is rejected"
negative="$WORK/legacy-timer-handle.check.txt"
if PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e6-timer-results/legacy_timer_handle.pf \
	> "$negative" 2>&1
then
	error_line "legacy timer-handle fixture unexpectedly checked"
	exit 1
fi
if ! grep -F 'error[Type]' "$negative" >/dev/null; then
	error_line "legacy timer-handle fixture did not emit error[Type]"
	cat "$negative" >&2
	exit 1
fi
if ! grep -F 'Result<TimerHandle, NativeError>' "$negative" >/dev/null; then
	error_line "legacy timer diagnostic omitted the Result signature"
	cat "$negative" >&2
	exit 1
fi
pass_line "timer scheduling must be unwrapped before cancellation"

section "BrowserBundle timer Result surface"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-d6/browser-example.pf \
	--target browser \
	--page "E6 timer Results" \
	-o "$WORK/timers.html"
if ! grep -F 'setTimer: core.$setTimer' "$WORK/timers.html" >/dev/null; then
	error_line "browser host lacks setTimer"
	exit 1
fi
if ! grep -F 'timer: timerModule' "$WORK/timers.html" >/dev/null; then
	error_line "browser builtin registry lacks timer module"
	exit 1
fi
pass_line "browser bundle links the shared timer Result implementation"

printf "\n%sSLICE E6 TIMER RESULTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"
