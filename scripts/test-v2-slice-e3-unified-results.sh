#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_COMPILER="${1:-boot/pfc.js}"
WORK="output/slice-e3-unified-results"
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
	error_line "Slice E3 requires the coreutils 'timeout' command"
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

section "Build compiler containing Slice E3"
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

section "Complete generated test suite under the E3 compiler"
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

section "Cross-module domain errors through core Result"
PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e3-unified-results/main.pf
timeout 10 env PFUN_HOME="$ROOT" node "$STAGE1" \
	run spec/slice-e3-unified-results/main.pf \
	> "$WORK/run.stdout.txt" \
	2> "$WORK/run.stderr.txt"
if [[ -s "$WORK/run.stderr.txt" ]]; then
	error_line "successful unified-Result fixture wrote stderr"
	cat "$WORK/run.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e3-unified-results/expected.txt \
	"$WORK/run.stdout.txt"
pass_line "domain unions compose in the shared Result error slot"

section "Direct NodeBundle behavior"
PFUN_HOME="$ROOT" node "$STAGE1" \
	build spec/slice-e3-unified-results/main.pf \
	-o "$WORK/main.js"
timeout 10 node "$WORK/main.js" \
	> "$WORK/bundle.stdout.txt" \
	2> "$WORK/bundle.stderr.txt"
if [[ -s "$WORK/bundle.stderr.txt" ]]; then
	error_line "successful unified-Result bundle wrote stderr"
	cat "$WORK/bundle.stderr.txt" >&2
	exit 1
fi
diff -u \
	spec/slice-e3-unified-results/expected.txt \
	"$WORK/bundle.stdout.txt"
pass_line "direct bundle preserves core Result and domain-error tags"

section "Specialized ReadResult constructors"
legacy_log="$WORK/legacy-read-constructors.check.txt"
if PFUN_HOME="$ROOT" node "$STAGE1" \
	check spec/slice-e3-unified-results/legacy-read-constructors.pf \
	> "$legacy_log" 2>&1
then
	error_line "legacy Ok/Eof/Err ReadResult fixture unexpectedly checked"
	exit 1
fi
if ! grep -F "Eof" "$legacy_log" >/dev/null; then
	error_line "legacy ReadResult diagnostic did not identify Eof"
	cat "$legacy_log" >&2
	exit 1
fi
pass_line "legacy ReadResult constructors are rejected"

node test/file_node_host_test.js
pass_line "Node text-file host uses ReadOk/ReadEof/ReadErr"
node test/binary_node_host_test.js
pass_line "Node binary-file host uses ReadOk/ReadEof/ReadErr"

section "Active-source Result ownership audit"
removed='BResult|LexResult|ParseResult|ResolveResult|EdgesResult|TopoResult|ParseOneResult|LoadResult|PipelineCheckResult|PipelineCompileResult|BuildFlagsResult|HostReadResult|ArtifactWriteResult|CliCheckResult|CliRunResult|CliBuildResult|ParsedSource|RawSource'
if rg -n \
	"(^|[[:space:]])(export[[:space:]]+)?type[[:space:]]+($removed)([[:space:]=]|$)" \
	src test --glob '*.pf' > "$WORK/removed-result-types.txt"
then
	error_line "active sources still declare collision-only Result wrappers"
	cat "$WORK/removed-result-types.txt" >&2
	exit 1
fi
pass_line "no removed collision-only Result wrapper is declared"

result_owners="$(rg -n 'builtinUnion\("Result"' src/builtins/spec.pf | wc -l | tr -d ' ')"
if [[ "$result_owners" != "1" ]]; then
	error_line "expected exactly one builtin Result owner, found $result_owners"
	exit 1
fi
pass_line "core is the sole builtin Result owner"

printf "\n%sALL SLICE E3 UNIFIED-RESULT TESTS PASSED%s\n" \
	"$BOLD_GREEN" "$RESET"
