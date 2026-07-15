#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
	BASE_COMPILER="$1"
elif [[ -f output/slice-c2/stage1/pfc.js ]]; then
	BASE_COMPILER="output/slice-c2/stage1/pfc.js"
elif [[ -f bootstrap-stage2/pfc.js ]]; then
	BASE_COMPILER="bootstrap-stage2/pfc.js"
else
	echo "error: no trusted C2 compiler was found" >&2
	exit 1
fi

if [[ ! -f "$BASE_COMPILER" ]]; then
	echo "error: seed compiler not found: $BASE_COMPILER" >&2
	exit 1
fi

WORK="output/slice-c3"
BRIDGE_SRC="$WORK/bridge-src"
BRIDGE="$WORK/bridge/pfc.js"
STAGE1="$WORK/stage1/pfc.js"
STAGE2="$WORK/stage2/pfc.js"
COMPILER="$ROOT/$STAGE1"

rm -rf "$WORK"
mkdir -p "$WORK/bridge" "$WORK/stage1" "$WORK/stage2"

echo "== TypeScript compiler build =="
npm run build

echo
echo "== Bootstrap Pfun test corpus =="
bash bootstrap/test/run-tests.sh --summary

echo
echo "== Node host manifest and behavior =="
node bootstrap/test/host_node_test.js

echo
echo "== Build C3 manifest bridge compiler =="
cp -R bootstrap/src "$BRIDGE_SRC"

python3 - "$BRIDGE_SRC/drivers/iofloor.pf" <<'PY_BRIDGE'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
match = re.search(
    r"(?m)^export\s+proc\s+executeNodeBundle\s*\([^)]*\)\s*\{",
    text,
)
if match is None:
    raise SystemExit(f"error: missing executeNodeBundle in {path}")
opening = text.find("{", match.start())
depth = 0
quote = None
escaped = False
closing = None
for index in range(opening, len(text)):
    char = text[index]
    if quote is not None:
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == quote:
            quote = None
        continue
    if char in ('"', "'"):
        quote = char
        continue
    if char == "{":
        depth += 1
    elif char == "}":
        depth -= 1
        if depth == 0:
            closing = index + 1
            break
if closing is None:
    raise SystemExit(f"error: unterminated executeNodeBundle in {path}")
replacement = """export proc executeNodeBundle(source, args) {
	let sourceText = source ++ "";
	let argText = join(map(fn value => value ++ "", args), "");
	if length(sourceText ++ argText) < 0 then {
		BOk { 0 }
	} else {
		BErr { "C3 bridge does not execute programs." }
	}
}"""
path.write_text(text[:match.start()] + replacement + text[closing:], encoding="utf-8")
PY_BRIDGE

if grep -F 'runNodeBundle(source, args)' \
	"$BRIDGE_SRC/drivers/iofloor.pf" >/dev/null
then
	echo "error: C3 bridge still calls the new host procedure" >&2
	exit 1
fi

PFUN_HOME="$ROOT" node "$BASE_COMPILER" \
	build "$BRIDGE_SRC/drivers/cli.pf" \
	-o "$BRIDGE"

echo
echo "== Build final compiler containing Slice C3 =="
PFUN_HOME="$ROOT" node "$BRIDGE" \
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
echo "== Run forwards arguments and stdout/stderr =="
RUN_CWD="$ROOT/$WORK/run-cwd"
RUN_STDOUT="$ROOT/$WORK/run-args.stdout.txt"
RUN_STDERR="$ROOT/$WORK/run-args.stderr.txt"
mkdir -p "$RUN_CWD"

(
	cd "$RUN_CWD"
	PFUN_HOME="$ROOT" node "$COMPILER" \
		run ../../../bootstrap/spec/slice-c3/run-args.pf \
		alpha "beta gamma" \
		> "$RUN_STDOUT" \
		2> "$RUN_STDERR"
)

diff -u \
	bootstrap/spec/slice-c3/run-args-stdout.txt \
	"$WORK/run-args.stdout.txt"

diff -u \
	bootstrap/spec/slice-c3/run-args-stderr.txt \
	"$WORK/run-args.stderr.txt"

if find "$RUN_CWD" -mindepth 1 -print -quit | grep -q .; then
	echo "error: pfc run left a persistent artifact in the working directory" >&2
	find "$RUN_CWD" -mindepth 1 -maxdepth 2 -print >&2
	exit 1
fi

echo "argument, stream, and cleanup behavior passed"

echo
echo "== Run forwards stdin =="
printf 'hello from stdin\n' | \
	PFUN_HOME="$ROOT" node "$STAGE1" \
		run bootstrap/spec/slice-c3/run-stdin.pf \
		> "$WORK/run-stdin.stdout.txt" \
		2> "$WORK/run-stdin.stderr.txt"

diff -u \
	bootstrap/spec/slice-c3/run-stdin-stdout.txt \
	"$WORK/run-stdin.stdout.txt"

if [[ -s "$WORK/run-stdin.stderr.txt" ]]; then
	echo "error: stdin probe unexpectedly wrote stderr" >&2
	cat "$WORK/run-stdin.stderr.txt" >&2
	exit 1
fi

echo "stdin forwarding passed"

echo
echo "== Run forwards child exit status =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run bootstrap/spec/slice-c3/run-exit.pf \
	> "$WORK/run-exit.stdout.txt" \
	2> "$WORK/run-exit.stderr.txt"
EXIT_RC=$?
set -e

if [[ "$EXIT_RC" -ne 7 ]]; then
	echo "error: child exit 7 became $EXIT_RC" >&2
	cat "$WORK/run-exit.stdout.txt" >&2
	cat "$WORK/run-exit.stderr.txt" >&2
	exit 1
fi

diff -u \
	bootstrap/spec/slice-c3/run-exit-stdout.txt \
	"$WORK/run-exit.stdout.txt"

if [[ -s "$WORK/run-exit.stderr.txt" ]]; then
	echo "error: exit-status probe unexpectedly wrote stderr" >&2
	cat "$WORK/run-exit.stderr.txt" >&2
	exit 1
fi

echo "exit-status forwarding passed"

echo
echo "== Run compile failures use stderr and do not execute =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" \
	run bootstrap/spec/slice-c1/pure-calls-proc.pf \
	> "$WORK/run-bad.stdout.txt" \
	2> "$WORK/run-bad.stderr.txt"
BAD_RC=$?
set -e

if [[ "$BAD_RC" -ne 1 ]]; then
	echo "error: invalid run returned $BAD_RC instead of 1" >&2
	exit 1
fi

if [[ -s "$WORK/run-bad.stdout.txt" ]]; then
	echo "error: invalid run polluted stdout or executed the program" >&2
	cat "$WORK/run-bad.stdout.txt" >&2
	exit 1
fi

if ! grep -F 'error[Purity]' "$WORK/run-bad.stderr.txt" >/dev/null; then
	echo "error: invalid run did not report the checker diagnostic" >&2
	cat "$WORK/run-bad.stderr.txt" >&2
	exit 1
fi

echo "run diagnostic behavior passed"

echo
echo "== Run usage failure =="
set +e
PFUN_HOME="$ROOT" node "$STAGE1" run \
	> "$WORK/run-usage.stdout.txt" \
	2> "$WORK/run-usage.stderr.txt"
USAGE_RC=$?
set -e

if [[ "$USAGE_RC" -ne 2 ]]; then
	echo "error: incomplete run returned $USAGE_RC instead of 2" >&2
	exit 1
fi

if [[ -s "$WORK/run-usage.stdout.txt" ]]; then
	echo "error: run usage polluted stdout" >&2
	cat "$WORK/run-usage.stdout.txt" >&2
	exit 1
fi

if ! grep -F 'pfc run <entry.pf> [args...]' \
	"$WORK/run-usage.stderr.txt" >/dev/null
then
	echo "error: run usage is missing from stderr" >&2
	cat "$WORK/run-usage.stderr.txt" >&2
	exit 1
fi

echo "run usage behavior passed"

echo
echo "== Slice C2 through Slice A regression gates =="
bash scripts/test-v2-slice-c2.sh "$STAGE1"

echo
echo "ALL SLICE C3 RUN-COMMAND TESTS PASSED"
